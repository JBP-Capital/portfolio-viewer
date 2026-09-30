import { randomUUID } from 'node:crypto'
import {
  applyLedger,
  LedgerError,
  portfolioNameSchema,
  ratePerListingUnit,
  ratePerMajorUnit,
  todayInTimeZone,
  transactionInputSchema,
  type ExportRecord,
  type ImportRow,
  type InstrumentType,
  type LedgerTransaction,
  type RowIssueCode,
} from '@pv/core'
import { and, asc, eq, gt, inArray, isNull, lt, max, or, sql } from 'drizzle-orm'
import type { Db, Executor } from './client.ts'
import { FxRateMissingError, isId, parseInput, ValidationError } from './errors.ts'
import { upsertListing } from './instruments.ts'
import { getMember } from './members.ts'
import { importDrafts, instruments, listings, portfolios, transactions } from './schema.ts'
import { assertLedgerValid, MOVES_NO_MONEY, resolveFxRate, rowValues, toLedgerTransaction, type TransactionRow } from './transactions.ts'

export interface ResolvedSecurity {
  instrumentId: string
  listingId: string
  name: string
  currency: string
}

/** Finds (or adds) the security a row names; null when it cannot be identified. */
export type SecurityResolver = (row: ImportRow) => Promise<ResolvedSecurity | null>

/** The part of a market-data provider the importer needs to add securities this instance does not know yet. */
export interface ImportProvider {
  describe(ref: { mic: string; symbol: string }): Promise<{ mic: string; symbol: string; name: string; currency: string; type: InstrumentType } | null>
  search(query: string): Promise<{ mic: string; symbol: string; name: string; type: InstrumentType }[]>
}

export type ImportIssueCode = RowIssueCode | 'oversell' | 'fx_missing' | 'future' | 'invalid' | 'duplicate' | 'ambiguous' | 'unpaired'

export interface ImportIssue {
  line: number
  column: string | null
  code: ImportIssueCode
  params?: Record<string, string>
  /** Shown, but does not block the import. */
  warning?: true
}

export interface PlannedRow extends ImportRow {
  security: ResolvedSecurity | null
  /** Null for a portfolio that the import creates. */
  portfolioId: string | null
}

export interface ImportPlan {
  rows: PlannedRow[]
  newPortfolios: string[]
  issues: ImportIssue[]
}

export class ImportRejectedError extends Error {
  readonly issues: ImportIssue[]

  constructor(issues: ImportIssue[]) {
    super(`Import refused: ${issues.length} issue(s)`)
    this.name = 'ImportRejectedError'
    this.issues = issues
  }
}

/** Placeholder id for validating rows of portfolios that do not exist yet. */
const NEW_PORTFOLIO = '00000000-0000-4000-8000-000000000000'
/** Input fields → CSV columns, for messages. */
const COLUMN: Record<string, string> = { tradeDate: 'date', splitRatio: 'split_ratio', fxRate: 'fx_rate', instrumentId: 'isin', listingId: 'exchange' }

const securityKey = (row: ImportRow) => (row.isin ? `isin:${row.isin}` : `listing:${row.exchange}:${row.symbol}`)

export function defaultSecurityResolver(db: Db, provider: ImportProvider | null): SecurityResolver {
  const columns = { instrumentId: instruments.id, listingId: listings.id, name: instruments.name, currency: listings.currency }
  const known = async (row: ImportRow): Promise<ResolvedSecurity | null> => {
    if (row.exchange && row.symbol) {
      const [byListing] = await db
        .select(columns)
        .from(listings)
        .innerJoin(instruments, eq(instruments.id, listings.instrumentId))
        .where(and(eq(listings.mic, row.exchange), eq(listings.symbol, row.symbol)))
      if (byListing) return byListing
    }
    if (row.isin) {
      const [byIsin] = await db.select(columns).from(instruments).innerJoin(listings, eq(listings.id, instruments.defaultListingId)).where(eq(instruments.isin, row.isin))
      if (byIsin) return byIsin
    }
    return null
  }
  return async (row) => {
    const found = await known(row)
    if (found || !provider) return found
    let ref = row.exchange && row.symbol ? { mic: row.exchange, symbol: row.symbol } : null
    // The row's ISIN is stored on the new security only when the provider found it by that ISIN.
    let isinConfirmed = false
    if (!ref && row.isin) {
      const candidates = await provider.search(row.isin).catch(() => [])
      if (candidates.length === 1) {
        ref = { mic: candidates[0]!.mic, symbol: candidates[0]!.symbol }
        isinConfirmed = true
      }
    }
    const details = ref ? await provider.describe(ref).catch(() => null) : null
    if (!details) return null
    const ids = await upsertListing(db, {
      name: details.name, type: details.type, isin: isinConfirmed ? row.isin : null, mic: details.mic, symbol: details.symbol, currency: details.currency,
    })
    return { ...ids, name: details.name, currency: details.currency }
  }
}

async function resolveAll(rows: readonly ImportRow[], resolve: SecurityResolver): Promise<Map<string, ResolvedSecurity | null>> {
  const found = new Map<string, ResolvedSecurity | null>()
  for (const row of rows) {
    const key = securityKey(row)
    if (!found.has(key)) found.set(key, await resolve(row))
  }
  return found
}

type RowValues = Omit<typeof transactions.$inferInsert, 'portfolioId'>

interface Prepared {
  row: ImportRow
  portfolioKey: string
  values: RowValues
}

const same = (a: number | null | undefined, b: number | null) => (a === null || a === undefined || b === null ? (a ?? null) === b : Math.abs(a - b) < 1e-9)
const MERGER_LEGS = new Set(['exchange_out', 'exchange_in'])

async function buildPlan(
  db: Executor,
  memberId: string,
  rows: readonly ImportRow[],
  securities: Map<string, ResolvedSecurity | null>,
  lock: boolean,
): Promise<{ plan: ImportPlan; prepared: Prepared[]; portfolioIds: Map<string, string> }> {
  // Writing: hold the member row so the base currency cannot change under the import.
  if (lock) await db.execute(sql`select 1 from members where id = ${memberId} for share`)
  const member = await getMember(db as Db, memberId)
  const today = todayInTimeZone(member.timezone)
  const query = db
    .select({ id: portfolios.id, name: portfolios.name })
    .from(portfolios)
    .where(and(eq(portfolios.memberId, memberId), isNull(portfolios.archivedAt)))
  const owned = lock ? await query.for('update') : await query
  const portfolioIds = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const p of owned) {
    const key = p.name.trim().toLowerCase()
    if (portfolioIds.has(key)) ambiguous.add(key)
    portfolioIds.set(key, p.id)
  }

  const issues: ImportIssue[] = []
  const prepared: Prepared[] = []
  const newPortfolios: string[] = []
  const plannedRows: PlannedRow[] = []

  for (const row of rows) {
    const portfolioKey = row.portfolio.trim().toLowerCase()
    const security = securities.get(securityKey(row)) ?? null
    if (ambiguous.has(portfolioKey)) {
      plannedRows.push({ ...row, security, portfolioId: null })
      issues.push({ line: row.line, column: 'portfolio', code: 'ambiguous' })
      continue
    }
    const portfolioId = portfolioIds.get(portfolioKey) ?? null
    plannedRows.push({ ...row, security, portfolioId })
    if (!portfolioId && !newPortfolios.some((n) => n.toLowerCase() === portfolioKey)) {
      if (portfolioNameSchema.safeParse(row.portfolio).success) newPortfolios.push(row.portfolio.trim())
      else issues.push({ line: row.line, column: 'portfolio', code: 'invalid' })
    }
    if (row.date > today) issues.push({ line: row.line, column: 'date', code: 'future' })
    if (!security) {
      issues.push({ line: row.line, column: row.isin ? 'isin' : 'symbol', code: 'security' })
      continue
    }
    if (MERGER_LEGS.has(row.type)) {
      // As createExchange stores them: in the base currency at rate 1; the cost basis moves between the legs.
      prepared.push({
        row,
        portfolioKey,
        values: {
          instrumentId: security.instrumentId, listingId: row.type === 'exchange_in' ? security.listingId : null, type: row.type as 'exchange_out' | 'exchange_in',
          tradeDate: row.date, currency: member.baseCurrency, fxRate: 1, fees: 0, taxes: 0, quantity: row.quantity, price: null, amount: null, splitRatio: null, note: row.note, linkId: null,
        },
      })
      continue
    }
    // Typed per major unit like in the form ("EUR per GBP"); stored per unit of the row currency.
    let fxRate = row.fxRate === null ? null : ratePerListingUnit(row.fxRate, row.currency)
    if (fxRate === null) {
      if (MOVES_NO_MONEY.has(row.type)) fxRate = 1
      else {
        try {
          fxRate = await resolveFxRate(db, row.currency, member.baseCurrency, row.date)
        } catch (error) {
          if (!(error instanceof FxRateMissingError)) throw error
          issues.push({ line: row.line, column: 'fx_rate', code: 'fx_missing', params: { currency: error.currency, date: error.date } })
          continue
        }
      }
    }
    try {
      const input = parseInput(transactionInputSchema, {
        portfolioId: portfolioId ?? NEW_PORTFOLIO,
        instrumentId: security.instrumentId,
        listingId: security.listingId,
        type: row.type,
        tradeDate: row.date,
        currency: row.currency,
        quantity: row.quantity,
        price: row.price,
        amount: row.amount,
        splitRatio: row.splitRatio,
        fees: row.fees,
        taxes: row.taxes,
        fxRate,
        note: row.note,
      })
      const { portfolioId: _placeholder, ...values } = rowValues(input, fxRate)
      prepared.push({ row, portfolioKey, values })
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      const path = error.issues[0]?.path ?? ''
      issues.push({ line: row.line, column: COLUMN[path] ?? (path || null), code: 'invalid' })
    }
  }

  // Merger legs: exactly one leg out and one leg in per link, portfolio and day.
  const groups = new Map<string, Prepared[]>()
  for (const p of prepared.filter((x) => MERGER_LEGS.has(x.row.type))) {
    const key = `${p.portfolioKey}\u0000${p.row.link}`
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  const unpaired = new Set<Prepared>()
  for (const legs of groups.values()) {
    const paired = legs.length === 2 && legs.some((l) => l.row.type === 'exchange_out') && legs.some((l) => l.row.type === 'exchange_in') && legs[0]!.row.date === legs[1]!.row.date
    if (!paired) for (const leg of legs) unpaired.add(leg)
    else {
      const linkId = randomUUID()
      for (const leg of legs) leg.values.linkId = linkId
    }
  }
  for (const leg of unpaired) issues.push({ line: leg.row.line, column: 'link', code: 'unpaired' })
  const ready = prepared.filter((p) => !unpaired.has(p))

  // Replay each portfolio with its stored and new transactions, as the ledger would after the import.
  const existingIds = [...new Set(ready.map((p) => portfolioIds.get(p.portfolioKey)).filter((id): id is string => id !== undefined))]
  const existing = existingIds.length === 0 ? [] : await db.select().from(transactions).where(inArray(transactions.portfolioId, existingIds))
  const byPortfolio = new Map<string, { stored: TransactionRow[]; added: Prepared[] }>()
  for (const p of ready) {
    const entry = byPortfolio.get(p.portfolioKey) ?? { stored: existing.filter((t) => t.portfolioId === portfolioIds.get(p.portfolioKey)), added: [] }
    entry.added.push(p)
    byPortfolio.set(p.portfolioKey, entry)
  }
  const start = Date.now()
  for (const { stored, added } of byPortfolio.values()) {
    for (const p of added) {
      const duplicate = stored.some(
        (s) => s.instrumentId === p.values.instrumentId && s.tradeDate === p.row.date && s.type === p.row.type && same(s.quantity, p.row.quantity) && same(s.price, p.row.price) && same(s.amount, p.row.amount),
      )
      if (duplicate) issues.push({ line: p.row.line, column: null, code: 'duplicate', warning: true })
    }
    const ledger: LedgerTransaction[] = [
      ...stored.map(toLedgerTransaction),
      ...added.map((p) => toLedgerTransaction({ ...p.values, portfolioId: NEW_PORTFOLIO, id: `import:${p.row.line}`, createdAt: new Date(start + p.row.line) } as TransactionRow)),
    ]
    try {
      applyLedger(ledger)
    } catch (error) {
      if (!(error instanceof LedgerError)) throw error
      const culprit = error.transactionId.startsWith('import:')
        ? added.find((p) => `import:${p.row.line}` === error.transactionId)
        : added.find((p) => p.values.instrumentId === stored.find((s) => s.id === error.transactionId)?.instrumentId)
      const line = culprit?.row.line ?? added[0]!.row.line
      issues.push(
        error.code === 'oversell'
          ? { line, column: 'quantity', code: 'oversell', ...(error.held === undefined ? {} : { params: { held: String(error.held) } }) }
          : { line, column: null, code: 'invalid' },
      )
    }
  }

  issues.sort((a, b) => a.line - b.line)
  return { plan: { rows: plannedRows, newPortfolios, issues }, prepared: ready, portfolioIds }
}

/** Checks an import without storing anything: which portfolios it creates and what is wrong with which row. */
export async function planImport(db: Db, memberId: string, rows: readonly ImportRow[], resolve: SecurityResolver): Promise<ImportPlan> {
  const securities = await resolveAll(rows, resolve)
  return (await buildPlan(db, memberId, rows, securities, false)).plan
}

async function store(
  t: Executor,
  memberId: string,
  rows: readonly ImportRow[],
  securities: Map<string, ResolvedSecurity | null>,
): Promise<{ transactions: number; portfolios: number }> {
  const { plan, prepared, portfolioIds } = await buildPlan(t, memberId, rows, securities, true)
  const blocking = plan.issues.filter((i) => !i.warning)
  if (blocking.length > 0) throw new ImportRejectedError(blocking)
  const [last] = await t.select({ position: max(portfolios.position) }).from(portfolios).where(eq(portfolios.memberId, memberId))
  let position = (last?.position ?? -1) + 1
  for (const name of plan.newPortfolios) {
    const [created] = await t.insert(portfolios).values({ memberId, name, position }).returning({ id: portfolios.id })
    portfolioIds.set(name.toLowerCase(), created!.id)
    position += 1
  }
  const touched = new Set<string>()
  for (const p of prepared) {
    const portfolioId = portfolioIds.get(p.portfolioKey)!
    touched.add(portfolioId)
    await t.insert(transactions).values({ ...p.values, portfolioId, source: 'import' })
  }
  for (const id of touched) await assertLedgerValid(t, id)
  return { transactions: prepared.length, portfolios: plan.newPortfolios.length }
}

/**
 * Stores all rows or none: the plan is made again inside one transaction holding the member's
 * portfolio rows, so a transaction entered meanwhile cannot leave an oversold ledger.
 */
export async function applyImport(db: Db, memberId: string, rows: readonly ImportRow[], resolve: SecurityResolver): Promise<{ transactions: number; portfolios: number }> {
  const securities = await resolveAll(rows, resolve)
  return db.transaction((t) => store(t, memberId, rows, securities))
}

/**
 * Imports a checked draft and uses it up in the same transaction, so confirming it twice (two tabs,
 * a retry) imports it once. Null when the draft is unknown, expired or already used.
 */
export async function applyImportDraft(db: Db, memberId: string, draftId: string, resolve: SecurityResolver): Promise<{ transactions: number; portfolios: number } | null> {
  const rows = await getImportDraft(db, memberId, draftId)
  if (!rows) return null
  const securities = await resolveAll(rows, resolve)
  return db.transaction(async (t) => {
    const claimed = await t
      .delete(importDrafts)
      .where(and(eq(importDrafts.id, draftId), eq(importDrafts.memberId, memberId), gt(importDrafts.createdAt, new Date(Date.now() - DRAFT_MINUTES * 60_000))))
      .returning({ id: importDrafts.id })
    if (claimed.length === 0) return null
    return store(t, memberId, rows, securities)
  })
}

const DRAFT_MINUTES = 15

/** Keeps checked rows between preview and confirmation, so the page never sends rows back to be trusted. */
export async function saveImportDraft(db: Db, memberId: string, rows: readonly ImportRow[]): Promise<string> {
  await db.delete(importDrafts).where(lt(importDrafts.createdAt, new Date(Date.now() - DRAFT_MINUTES * 60_000)))
  const [draft] = await db.insert(importDrafts).values({ memberId, rows: [...rows] }).returning({ id: importDrafts.id })
  return draft!.id
}

/** The member's draft, or null when it is unknown, someone else's or older than 15 minutes. */
export async function getImportDraft(db: Db, memberId: string, draftId: string, now: Date = new Date()): Promise<ImportRow[] | null> {
  if (!isId(draftId)) return null
  const [draft] = await db.select().from(importDrafts).where(and(eq(importDrafts.id, draftId), eq(importDrafts.memberId, memberId)))
  if (!draft || draft.createdAt.getTime() < now.getTime() - DRAFT_MINUTES * 60_000) return null
  return draft.rows
}

export async function deleteImportDraft(db: Db, memberId: string, draftId: string): Promise<void> {
  if (!isId(draftId)) return
  await db.delete(importDrafts).where(and(eq(importDrafts.id, draftId), eq(importDrafts.memberId, memberId)))
}

/** Every transaction of the member (archived portfolios included), oldest first, for the CSV export. */
export async function exportRecords(db: Db, memberId: string): Promise<ExportRecord[]> {
  const rows = await db
    .select({ tx: transactions, portfolio: portfolios.name, isin: instruments.isin, symbol: listings.symbol, exchange: listings.mic })
    .from(transactions)
    .innerJoin(portfolios, eq(portfolios.id, transactions.portfolioId))
    .innerJoin(instruments, eq(instruments.id, transactions.instrumentId))
    .leftJoin(
      listings,
      or(eq(listings.id, transactions.listingId), and(isNull(transactions.listingId), eq(listings.id, instruments.defaultListingId))),
    )
    .where(eq(portfolios.memberId, memberId))
    // Rows written in one database transaction share created_at; the type (enum order) keeps merger legs in order.
    .orderBy(asc(transactions.tradeDate), asc(portfolios.name), asc(transactions.createdAt), asc(transactions.type), asc(transactions.id))
  return rows.map(({ tx, portfolio, isin, symbol, exchange }) => ({
    date: tx.tradeDate,
    portfolio,
    type: tx.type,
    isin,
    symbol,
    exchange,
    quantity: tx.quantity,
    price: tx.price,
    currency: tx.currency,
    fees: tx.fees,
    taxes: tx.taxes,
    amount: tx.amount,
    note: tx.note,
    fxRate: ratePerMajorUnit(tx.fxRate, tx.currency),
    splitRatio: tx.splitRatio,
    link: tx.linkId,
  }))
}
