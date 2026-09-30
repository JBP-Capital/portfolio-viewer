import { randomUUID } from 'node:crypto'
import { LedgerError } from '@pv/core'
import { describe, expect, it } from 'vitest'
import { FxRateMissingError, NotFoundError, ValidationError } from '../src/errors.ts'
import { upsertListing } from '../src/instruments.ts'
import { createPortfolio, getPortfolio } from '../src/portfolios.ts'
import { fxRates } from '../src/schema.ts'
import { createExchange, createTransaction, deleteTransaction, listTransactions, updateTransaction } from '../src/transactions.ts'
import { makeMember, useTestDb } from './helpers.ts'

const { db } = useTestDb()

async function setup(currency = 'EUR') {
  const member = await makeMember(db, 'owner@example.com')
  const portfolio = await createPortfolio(db, member.id, { name: 'Main' })
  const { instrumentId } = await upsertListing(db, { name: 'Test', mic: 'XETR', symbol: 'TST', currency })
  const buy = (quantity: number, tradeDate = '2026-01-05', extra: Record<string, unknown> = {}) => ({
    portfolioId: portfolio.id, instrumentId, type: 'buy', tradeDate, currency, quantity, price: 100, ...extra,
  })
  const sell = (quantity: number, tradeDate = '2026-02-01') => ({
    portfolioId: portfolio.id, instrumentId, type: 'sell', tradeDate, currency, quantity, price: 110,
  })
  return { member, portfolio, instrumentId, buy, sell }
}

describe('transactions', () => {
  it('stores a euro buy with rate 1 and lists it', async () => {
    const { member, portfolio, buy } = await setup()
    const row = await createTransaction(db, member.id, buy(10))
    expect(row).toMatchObject({ fxRate: 1, quantity: 10, price: 100, source: 'manual' })
    expect(await listTransactions(db, member.id, portfolio.id)).toHaveLength(1)
  })

  it('fills the rate from the latest reference rate within 7 days', async () => {
    const { member, buy } = await setup('USD')
    await db.insert(fxRates).values({ currency: 'USD', date: '2026-01-02', perEur: 1.25 })
    const row = await createTransaction(db, member.id, buy(10))
    expect(row.fxRate).toBeCloseTo(0.8, 9)
  })

  it('converts pence with the pound rate', async () => {
    const { member, buy } = await setup('GBX')
    await db.insert(fxRates).values({ currency: 'GBP', date: '2026-01-05', perEur: 0.85 })
    const row = await createTransaction(db, member.id, buy(10))
    expect(row.fxRate).toBeCloseTo(0.01 / 0.85, 12)
  })

  it('fails with a clear error when no rate is available, unless one is entered', async () => {
    const { member, buy } = await setup('USD')
    await expect(createTransaction(db, member.id, buy(10))).rejects.toBeInstanceOf(FxRateMissingError)
    const row = await createTransaction(db, member.id, buy(10, '2026-01-05', { fxRate: 0.9 }))
    expect(row.fxRate).toBe(0.9)
  })

  it('rejects an oversell and stores nothing', async () => {
    const { member, portfolio, buy, sell } = await setup()
    await createTransaction(db, member.id, buy(10))
    await expect(createTransaction(db, member.id, sell(11))).rejects.toBeInstanceOf(LedgerError)
    expect(await listTransactions(db, member.id, portfolio.id)).toHaveLength(1)
  })

  it('rejects editing an old buy when a later sell would no longer be covered', async () => {
    const { member, portfolio, buy, sell } = await setup()
    const first = await createTransaction(db, member.id, buy(10))
    await createTransaction(db, member.id, sell(8))
    await expect(updateTransaction(db, member.id, first.id, buy(5))).rejects.toBeInstanceOf(LedgerError)
    const rows = await listTransactions(db, member.id, portfolio.id)
    expect(rows.find((r) => r.id === first.id)!.quantity).toBe(10)
  })

  it('rejects deleting a buy that a later sell depends on', async () => {
    const { member, portfolio, buy, sell } = await setup()
    const first = await createTransaction(db, member.id, buy(10))
    await createTransaction(db, member.id, sell(8))
    await expect(deleteTransaction(db, member.id, first.id)).rejects.toBeInstanceOf(LedgerError)
    expect(await listTransactions(db, member.id, portfolio.id)).toHaveLength(2)
  })

  it('updates a transaction and refuses to move it to another portfolio', async () => {
    const { member, buy } = await setup()
    const row = await createTransaction(db, member.id, buy(10))
    const updated = await updateTransaction(db, member.id, row.id, buy(12, '2026-01-06'))
    expect(updated).toMatchObject({ quantity: 12, tradeDate: '2026-01-06' })
    const other = await createPortfolio(db, member.id, { name: 'Other' })
    await expect(updateTransaction(db, member.id, row.id, { ...buy(12), portfolioId: other.id })).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses trade dates in the future', async () => {
    const { member, buy } = await setup()
    await expect(createTransaction(db, member.id, buy(1, '2999-01-01'))).rejects.toMatchObject({ name: 'ValidationError', issues: [{ path: 'tradeDate' }] })
  })

  it('refuses an unknown security and a listing of another security', async () => {
    const { member, buy } = await setup()
    await expect(createTransaction(db, member.id, buy(1, '2026-01-05', { instrumentId: randomUUID() }))).rejects.toMatchObject({ issues: [{ path: 'instrumentId' }] })
    const other = await upsertListing(db, { name: 'Other', mic: 'XETR', symbol: 'OTH', currency: 'EUR' })
    await expect(createTransaction(db, member.id, buy(1, '2026-01-05', { listingId: other.listingId }))).rejects.toMatchObject({ issues: [{ path: 'listingId' }] })
  })

  it('refuses a merger into an unknown security', async () => {
    const { member, portfolio, instrumentId, buy } = await setup()
    await createTransaction(db, member.id, buy(10))
    await expect(
      createExchange(db, member.id, { portfolioId: portfolio.id, tradeDate: '2026-04-07', fromInstrumentId: instrumentId, fromQuantity: 10, toInstrumentId: randomUUID(), toQuantity: 5 }),
    ).rejects.toMatchObject({ issues: [{ path: 'toInstrumentId' }] })
  })

  it('records an exchange as two linked legs and deletes both together', async () => {
    const { member, portfolio, instrumentId, buy } = await setup()
    const { instrumentId: coeur } = await upsertListing(db, { name: 'Coeur', mic: 'XNYS', symbol: 'CDE', currency: 'USD' })
    await createTransaction(db, member.id, buy(1000))
    const [out, into] = await createExchange(db, member.id, {
      portfolioId: portfolio.id, tradeDate: '2026-04-07', fromInstrumentId: instrumentId, fromQuantity: 1000, toInstrumentId: coeur, toQuantity: 495.9,
    })
    expect(out.linkId).toBe(into.linkId)
    expect([out.type, into.type]).toEqual(['exchange_out', 'exchange_in'])
    await expect(updateTransaction(db, member.id, into.id, buy(1))).rejects.toBeInstanceOf(ValidationError)
    await deleteTransaction(db, member.id, into.id)
    expect(await listTransactions(db, member.id, portfolio.id)).toHaveLength(1)
  })

  it('stores splits and transfers out without an exchange rate (no money moves)', async () => {
    const { member, portfolio, instrumentId, buy } = await setup('XYZ')
    await createTransaction(db, member.id, buy(10, '2026-01-05', { fxRate: 0.5 }))
    const base = { portfolioId: portfolio.id, instrumentId, currency: 'XYZ' }
    expect(await createTransaction(db, member.id, { ...base, type: 'split', tradeDate: '2026-02-02', splitRatio: 2 })).toMatchObject({ fxRate: 1 })
    expect(await createTransaction(db, member.id, { ...base, type: 'transfer_out', tradeDate: '2026-03-02', quantity: 5 })).toMatchObject({ fxRate: 1 })
  })

  it('treats a malformed id as not found', async () => {
    const { member, buy } = await setup()
    await expect(getPortfolio(db, member.id, 'abc')).rejects.toBeInstanceOf(NotFoundError)
    await expect(deleteTransaction(db, member.id, 'abc')).rejects.toBeInstanceOf(NotFoundError)
    await expect(updateTransaction(db, member.id, 'abc', buy(1))).rejects.toBeInstanceOf(NotFoundError)
  })
})
