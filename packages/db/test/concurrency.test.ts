import { applyLedger } from '@pv/core'
import { describe, expect, it } from 'vitest'
import { upsertListing } from '../src/instruments.ts'
import { createPortfolio } from '../src/portfolios.ts'
import { createTransaction, deleteTransaction, listTransactions, toLedgerTransaction } from '../src/transactions.ts'
import { makeMember, useTestDb } from './helpers.ts'

const { db } = useTestDb()

async function setup() {
  const member = await makeMember(db, 'owner@example.com')
  const portfolio = await createPortfolio(db, member.id, { name: 'Main' })
  const { instrumentId } = await upsertListing(db, { name: 'Test', mic: 'XETR', symbol: 'TST', currency: 'EUR' })
  const trade = (type: 'buy' | 'sell', quantity: number, tradeDate: string) => ({
    portfolioId: portfolio.id, instrumentId, type, tradeDate, currency: 'EUR', quantity, price: 100,
  })
  return { member, portfolio, trade }
}

async function storedLedgerAddsUp(memberId: string, portfolioId: string) {
  const rows = await listTransactions(db, memberId, portfolioId)
  applyLedger(rows.map(toLedgerTransaction))
  return rows
}

describe('concurrent writes to one portfolio', () => {
  it('lets only one of two simultaneous full sells through', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { member, portfolio, trade } = await setup()
      await createTransaction(db, member.id, trade('buy', 10, '2026-01-05'))
      const results = await Promise.allSettled([
        createTransaction(db, member.id, trade('sell', 10, '2026-02-01')),
        createTransaction(db, member.id, trade('sell', 10, '2026-02-01')),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(await storedLedgerAddsUp(member.id, portfolio.id)).toHaveLength(2)
      await db.execute('truncate members, portfolios, instruments, listings, transactions cascade')
    }
  })

  it('never stores a sell whose buy was deleted at the same moment', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { member, portfolio, trade } = await setup()
      const buy = await createTransaction(db, member.id, trade('buy', 10, '2026-01-05'))
      await Promise.allSettled([
        deleteTransaction(db, member.id, buy.id),
        createTransaction(db, member.id, trade('sell', 10, '2026-02-01')),
      ])
      await storedLedgerAddsUp(member.id, portfolio.id)
      await db.execute('truncate members, portfolios, instruments, listings, transactions cascade')
    }
  })
})
