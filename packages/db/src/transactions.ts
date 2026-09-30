import { randomUUID } from 'node:crypto'
import {
  addDays,
  applyLedger,
  exchangeInputSchema,
  todayInTimeZone,
  toMajorUnit,
  transactionInputSchema,
  type LedgerTransaction,
  type TransactionInput,
} from '@pv/core'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { Db, Executor } from './client.ts'
import { assertId, FxRateMissingError, NotFoundError, parseInput, ValidationError } from './errors.ts'
import { fxRates, instruments, listings, members, portfolios, transactions } from './schema.ts'

export type TransactionRow = typeof transactions.$inferSelect

export function toLedgerTransaction(row: TransactionRow): LedgerTransaction {
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    type: row.type,
    tradeDate: row.tradeDate,
    quantity: row.quantity,
    price: row.price,
    fxRate: row.fxRate,
    fees: row.fees,
    taxes: row.taxes,
    amount: row.amount,
    splitRatio: row.splitRatio,
    linkId: row.linkId,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Holds the member row until the write ends, so the base currency (which the stored rates convert
 * into) cannot change between reading it and committing; see updateMemberSettings.
 */
async function lockMember(db: Executor, memberId: string): Promise<void> {
  assertId(memberId, 'Member')
  await db.execute(sql`select 1 from members where id = ${memberId} for share`)
}

/** Splits and transfers out are valued at average cost; no exchange rate is needed (or asked for). */
export const MOVES_NO_MONEY: ReadonlySet<string> = new Set(['split', 'transfer_out'])

/**
 * The member's portfolio. Writes pass `lock` so the portfolio row is locked until the surrounding
 * transaction ends: writes to one portfolio then run one after another, and the ledger replay of
 * each sees the other's committed rows.
 */
async function ownedPortfolio(
  db: Executor,
  memberId: string,
  portfolioId: string,
  lock = false,
): Promise<{ id: string; baseCurrency: string; timezone: string }> {
  assertId(portfolioId, 'Portfolio')
  const query = db
    .select({ id: portfolios.id, baseCurrency: members.baseCurrency, timezone: members.timezone })
    .from(portfolios)
    .innerJoin(members, eq(members.id, portfolios.memberId))
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.memberId, memberId)))
  const [row] = lock ? await query.for('update', { of: portfolios }) : await query
  if (!row) throw new NotFoundError('Portfolio')
  return row
}

/** The member's transaction, with its portfolio row locked for the surrounding write transaction. */
async function ownedTransactionLocked(
  db: Executor,
  memberId: string,
  transactionId: string,
): Promise<TransactionRow & { baseCurrency: string; timezone: string }> {
  assertId(transactionId, 'Transaction')
  const [row] = await db
    .select({ tx: transactions, baseCurrency: members.baseCurrency, timezone: members.timezone })
    .from(transactions)
    .innerJoin(portfolios, eq(portfolios.id, transactions.portfolioId))
    .innerJoin(members, eq(members.id, portfolios.memberId))
    .where(and(eq(transactions.id, transactionId), eq(portfolios.memberId, memberId)))
    .for('update', { of: portfolios })
  if (!row) throw new NotFoundError('Transaction')
  return { ...row.tx, baseCurrency: row.baseCurrency, timezone: row.timezone }
}

function assertNotInFuture(tradeDate: string, timezone: string): void {
  if (tradeDate > todayInTimeZone(timezone)) {
    throw new ValidationError('The trade date lies in the future', [{ path: 'tradeDate', message: 'future' }])
  }
}

/** The security must exist, and a given listing must be one of its listings. */
async function assertSecurity(db: Executor, instrumentId: string, listingId: string | null, paths = { instrument: 'instrumentId', listing: 'listingId' }) {
  const [instrument] = await db.select({ id: instruments.id }).from(instruments).where(eq(instruments.id, instrumentId))
  if (!instrument) throw new ValidationError('Unknown security', [{ path: paths.instrument, message: 'unknown' }])
  if (listingId) {
    const [listing] = await db.select({ instrumentId: listings.instrumentId }).from(listings).where(eq(listings.id, listingId))
    if (!listing || listing.instrumentId !== instrumentId) {
      throw new ValidationError('The listing belongs to another security', [{ path: paths.listing, message: 'mismatch' }])
    }
  }
}

/** Replays the whole portfolio; throws LedgerError (rolling back the surrounding transaction) when it no longer adds up. */
export async function assertLedgerValid(db: Executor, portfolioId: string): Promise<void> {
  const rows = await db.select().from(transactions).where(eq(transactions.portfolioId, portfolioId))
  applyLedger(rows.map(toLedgerTransaction))
}

/** Base currency units per one unit of `currency` on `date`, from the latest reference rate of the 7 days before. */
export async function resolveFxRate(db: Executor, currency: string, baseCurrency: string, date: string): Promise<number> {
  const { currency: major, amount: factor } = toMajorUnit(currency, 1)
  if (major === baseCurrency) return factor
  const perEur = async (code: string): Promise<number> => {
    if (code === 'EUR') return 1
    const [row] = await db
      .select({ perEur: fxRates.perEur })
      .from(fxRates)
      .where(and(eq(fxRates.currency, code), lte(fxRates.date, date), gte(fxRates.date, addDays(date, -7))))
      .orderBy(desc(fxRates.date))
      .limit(1)
    if (!row) throw new FxRateMissingError(code, date)
    return row.perEur
  }
  return (factor * (await perEur(baseCurrency))) / (await perEur(major))
}

/** The stored columns of a validated transaction input. */
export function rowValues(input: TransactionInput, fxRate: number) {
  const values = {
    portfolioId: input.portfolioId,
    instrumentId: input.instrumentId,
    listingId: input.listingId,
    type: input.type,
    tradeDate: input.tradeDate,
    currency: input.currency,
    fxRate,
    fees: input.fees,
    taxes: input.taxes,
    note: input.note,
    quantity: null as number | null,
    price: null as number | null,
    amount: null as number | null,
    splitRatio: null as number | null,
  }
  switch (input.type) {
    case 'buy':
    case 'sell':
    case 'transfer_in':
    case 'transfer_out':
      return { ...values, quantity: input.quantity, price: input.price }
    case 'dividend':
      return { ...values, quantity: input.quantity, amount: input.amount }
    case 'split':
      return { ...values, splitRatio: input.splitRatio }
  }
}

export async function listTransactions(db: Db, memberId: string, portfolioId: string): Promise<TransactionRow[]> {
  await ownedPortfolio(db, memberId, portfolioId)
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.portfolioId, portfolioId))
    .orderBy(desc(transactions.tradeDate), desc(transactions.createdAt))
}

export async function createTransaction(db: Db, memberId: string, raw: unknown, source: 'manual' | 'import' = 'manual'): Promise<TransactionRow> {
  const input = parseInput(transactionInputSchema, raw)
  return db.transaction(async (t) => {
    await lockMember(t, memberId)
    const portfolio = await ownedPortfolio(t, memberId, input.portfolioId, true)
    assertNotInFuture(input.tradeDate, portfolio.timezone)
    await assertSecurity(t, input.instrumentId, input.listingId)
    const fxRate = input.fxRate ?? (MOVES_NO_MONEY.has(input.type) ? 1 : await resolveFxRate(t, input.currency, portfolio.baseCurrency, input.tradeDate))
    const [row] = await t.insert(transactions).values({ ...rowValues(input, fxRate), source }).returning()
    await assertLedgerValid(t, input.portfolioId)
    return row!
  })
}

export async function updateTransaction(db: Db, memberId: string, transactionId: string, raw: unknown): Promise<TransactionRow> {
  const input = parseInput(transactionInputSchema, raw)
  return db.transaction(async (t) => {
    await lockMember(t, memberId)
    const existing = await ownedTransactionLocked(t, memberId, transactionId)
    if (existing.linkId) throw new ValidationError('An exchange is changed by deleting it and entering it again')
    if (input.portfolioId !== existing.portfolioId) throw new ValidationError('A transaction cannot be moved to another portfolio')
    assertNotInFuture(input.tradeDate, existing.timezone)
    await assertSecurity(t, input.instrumentId, input.listingId)
    const fxRate = input.fxRate ?? (MOVES_NO_MONEY.has(input.type) ? 1 : await resolveFxRate(t, input.currency, existing.baseCurrency, input.tradeDate))
    const [row] = await t
      .update(transactions)
      .set({ ...rowValues(input, fxRate), updatedAt: new Date() })
      .where(eq(transactions.id, transactionId))
      .returning()
    // Deleted by a write that held the portfolio lock before this one.
    if (!row) throw new NotFoundError('Transaction')
    await assertLedgerValid(t, existing.portfolioId)
    return row
  })
}

/** Deletes a transaction; deleting one leg of an exchange deletes both legs. */
export async function deleteTransaction(db: Db, memberId: string, transactionId: string): Promise<void> {
  await db.transaction(async (t) => {
    const existing = await ownedTransactionLocked(t, memberId, transactionId)
    const target = existing.linkId
      ? and(eq(transactions.linkId, existing.linkId), eq(transactions.portfolioId, existing.portfolioId))
      : eq(transactions.id, transactionId)
    await t.delete(transactions).where(target)
    await assertLedgerValid(t, existing.portfolioId)
  })
}

/** Records a merger or share exchange: the cost basis moves from one security to the other. */
export async function createExchange(db: Db, memberId: string, raw: unknown): Promise<[TransactionRow, TransactionRow]> {
  const input = parseInput(exchangeInputSchema, raw)
  return db.transaction(async (t) => {
    await lockMember(t, memberId)
    const portfolio = await ownedPortfolio(t, memberId, input.portfolioId, true)
    assertNotInFuture(input.tradeDate, portfolio.timezone)
    await assertSecurity(t, input.fromInstrumentId, null, { instrument: 'fromInstrumentId', listing: 'fromListingId' })
    await assertSecurity(t, input.toInstrumentId, input.toListingId, { instrument: 'toInstrumentId', listing: 'toListingId' })
    const linkId = randomUUID()
    const shared = { portfolioId: input.portfolioId, tradeDate: input.tradeDate, currency: portfolio.baseCurrency, fxRate: 1, linkId, note: input.note }
    const [out] = await t
      .insert(transactions)
      .values({ ...shared, type: 'exchange_out', instrumentId: input.fromInstrumentId, quantity: input.fromQuantity })
      .returning()
    const [into] = await t
      .insert(transactions)
      .values({ ...shared, type: 'exchange_in', instrumentId: input.toInstrumentId, listingId: input.toListingId, quantity: input.toQuantity })
      .returning()
    await assertLedgerValid(t, input.portfolioId)
    return [out!, into!]
  })
}
