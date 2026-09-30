import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { NotFoundError } from '../src/errors.ts'
import { upsertListing } from '../src/instruments.ts'
import { archivePortfolio, createPortfolio, deletePortfolio, getPortfolio, listPortfolios, renamePortfolio } from '../src/portfolios.ts'
import { createExchange, createTransaction, deleteTransaction, listTransactions, updateTransaction } from '../src/transactions.ts'
import { makeMember, useTestDb } from './helpers.ts'

const { db } = useTestDb()

async function twoTenants() {
  const alice = await makeMember(db, 'alice@example.com', { userId: randomUUID() })
  const bob = await makeMember(db, 'bob@example.com', { userId: randomUUID() })
  const portfolio = await createPortfolio(db, alice.id, { name: 'Alice depot' })
  const { instrumentId } = await upsertListing(db, { name: 'Test', mic: 'XETR', symbol: 'TST', currency: 'EUR' })
  const input = { portfolioId: portfolio.id, instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: 'EUR', quantity: 10, price: 100 }
  const tx = await createTransaction(db, alice.id, input)
  return { alice, bob, portfolio, instrumentId, input, tx }
}

describe('tenant isolation', () => {
  it('never lists another member’s portfolios', async () => {
    const { bob } = await twoTenants()
    expect(await listPortfolios(db, bob.id)).toEqual([])
  })

  it('treats another member’s portfolio as not found for every operation', async () => {
    const { alice, bob, portfolio } = await twoTenants()
    await expect(getPortfolio(db, bob.id, portfolio.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(renamePortfolio(db, bob.id, portfolio.id, 'Mine now')).rejects.toBeInstanceOf(NotFoundError)
    await expect(archivePortfolio(db, bob.id, portfolio.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(deletePortfolio(db, bob.id, portfolio.id)).rejects.toBeInstanceOf(NotFoundError)
    expect((await getPortfolio(db, alice.id, portfolio.id)).name).toBe('Alice depot')
  })

  it('treats another member’s transactions as not found', async () => {
    const { alice, bob, portfolio, instrumentId, input, tx } = await twoTenants()
    await expect(listTransactions(db, bob.id, portfolio.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(createTransaction(db, bob.id, input)).rejects.toBeInstanceOf(NotFoundError)
    await expect(updateTransaction(db, bob.id, tx.id, { ...input, quantity: 1 })).rejects.toBeInstanceOf(NotFoundError)
    await expect(deleteTransaction(db, bob.id, tx.id)).rejects.toBeInstanceOf(NotFoundError)
    const { instrumentId: other } = await upsertListing(db, { name: 'Other', mic: 'XETR', symbol: 'OTH', currency: 'EUR' })
    await expect(
      createExchange(db, bob.id, { portfolioId: portfolio.id, tradeDate: '2026-02-01', fromInstrumentId: instrumentId, fromQuantity: 1, toInstrumentId: other, toQuantity: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError)
    const rows = await listTransactions(db, alice.id, portfolio.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.quantity).toBe(10)
  })
})
