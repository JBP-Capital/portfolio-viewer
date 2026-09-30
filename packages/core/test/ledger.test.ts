import { describe, expect, it } from 'vitest'
import { applyLedger, averageCost, LedgerError, type LedgerTransaction } from '../src/ledger.ts'

let seq = 0
function tx(partial: Partial<LedgerTransaction> & Pick<LedgerTransaction, 'type' | 'tradeDate'>): LedgerTransaction {
  seq += 1
  return {
    id: `t${seq}`,
    instrumentId: 'A',
    quantity: null,
    price: null,
    fxRate: 1,
    fees: 0,
    taxes: 0,
    amount: null,
    splitRatio: null,
    linkId: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, seq)).toISOString(),
    ...partial,
  }
}

function expectLedgerError(fn: () => unknown, code: LedgerError['code'], transactionId: string) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerError)
    expect((error as LedgerError).code).toBe(code)
    expect((error as LedgerError).transactionId).toBe(transactionId)
    return
  }
  throw new Error('expected a LedgerError')
}

describe('applyLedger', () => {
  it('adds quantity and cost including fees in base currency on a buy', () => {
    const p = applyLedger([tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100, fees: 5, fxRate: 0.9 })]).get('A')!
    expect(p.quantity).toBe(10)
    expect(p.costBasis).toBeCloseTo(904.5, 9)
    expect(averageCost(p)).toBeCloseTo(90.45, 9)
    expect(p.feesPaid).toBeCloseTo(4.5, 9)
  })

  it('adds taxes paid on a buy (stamp duty, transaction tax) to the cost basis', () => {
    const p = applyLedger([tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100, fees: 5, taxes: 3 })]).get('A')!
    expect(p.costBasis).toBeCloseTo(1008, 9)
    expect(p.taxesPaid).toBeCloseTo(3, 9)
  })

  it('realizes gains against the average cost on a sell', () => {
    const p = applyLedger([
      tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 }),
      tx({ type: 'buy', tradeDate: '2026-01-06', quantity: 10, price: 120 }),
      tx({ type: 'sell', tradeDate: '2026-01-07', quantity: 5, price: 130, fees: 2, taxes: 10 }),
    ]).get('A')!
    expect(p.quantity).toBe(15)
    expect(p.costBasis).toBeCloseTo(1650, 9)
    expect(p.realizedGain).toBeCloseTo(98, 9)
    expect(p.taxesPaid).toBeCloseTo(10, 9)
  })

  it('uses the given price as average cost on a transfer in and ignores fees', () => {
    const p = applyLedger([tx({ type: 'transfer_in', tradeDate: '2026-01-05', quantity: 100, price: 12.5, fees: 3 })]).get('A')!
    expect(p.costBasis).toBeCloseTo(1250, 9)
    expect(p.feesPaid).toBe(0)
  })

  it('removes cost without realizing on a transfer out', () => {
    const p = applyLedger([
      tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 }),
      tx({ type: 'transfer_out', tradeDate: '2026-01-06', quantity: 4 }),
    ]).get('A')!
    expect(p.quantity).toBe(6)
    expect(p.costBasis).toBeCloseTo(600, 9)
    expect(p.realizedGain).toBe(0)
  })

  it('multiplies quantity and keeps cost on a split', () => {
    const p = applyLedger([
      tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 }),
      tx({ type: 'split', tradeDate: '2026-02-01', splitRatio: 2 }),
    ]).get('A')!
    expect(p.quantity).toBe(20)
    expect(p.costBasis).toBeCloseTo(1000, 9)
    expect(averageCost(p)).toBeCloseTo(50, 9)
  })

  it('records gross and net dividends in base currency', () => {
    const p = applyLedger([tx({ type: 'dividend', tradeDate: '2026-03-01', amount: 50, taxes: 13.19, fxRate: 0.9 })]).get('A')!
    expect(p.dividendsGross).toBeCloseTo(45, 9)
    expect(p.dividendsNet).toBeCloseTo(33.129, 9)
    expect(p.taxesPaid).toBeCloseTo(11.871, 9)
  })

  it('moves the cost basis to the new security on an exchange (New Gold into Coeur)', () => {
    const positions = applyLedger([
      tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 1000, price: 3 }),
      tx({ type: 'exchange_in', tradeDate: '2026-04-07', instrumentId: 'B', quantity: 495.9, linkId: 'L1' }),
      tx({ type: 'exchange_out', tradeDate: '2026-04-07', quantity: 1000, linkId: 'L1' }),
    ])
    expect(positions.get('A')).toMatchObject({ quantity: 0, costBasis: 0, realizedGain: 0 })
    expect(positions.get('B')!.quantity).toBeCloseTo(495.9, 9)
    expect(positions.get('B')!.costBasis).toBeCloseTo(3000, 9)
  })

  it('rejects selling more than is held', () => {
    const sell = tx({ type: 'sell', tradeDate: '2026-01-06', quantity: 11, price: 100 })
    expectLedgerError(() => applyLedger([tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 }), sell]), 'oversell', sell.id)
    expect(() => applyLedger([tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 }), sell])).toThrow(expect.objectContaining({ held: 10 }))
  })

  it('leaves exactly zero after selling fractional buys in full', () => {
    const p = applyLedger([
      tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 0.1, price: 10 }),
      tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 0.2, price: 10 }),
      tx({ type: 'sell', tradeDate: '2026-01-06', quantity: 0.3, price: 10 }),
    ]).get('A')!
    expect(p.quantity).toBe(0)
    expect(p.costBasis).toBe(0)
    expect(p.realizedGain).toBeCloseTo(0, 9)
  })

  it('applies a same-day buy before a sell regardless of entry order', () => {
    const sell = tx({ type: 'sell', tradeDate: '2026-01-05', quantity: 5, price: 110 })
    const buy = tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 })
    const p = applyLedger([sell, buy]).get('A')!
    expect(p.quantity).toBe(5)
    expect(p.realizedGain).toBeCloseTo(50, 9)
  })

  it('applies transactions in date order regardless of input order', () => {
    const p = applyLedger([
      tx({ type: 'sell', tradeDate: '2026-02-01', quantity: 10, price: 150 }),
      tx({ type: 'buy', tradeDate: '2026-01-01', quantity: 10, price: 100 }),
    ]).get('A')!
    expect(p.quantity).toBe(0)
    expect(p.realizedGain).toBeCloseTo(500, 9)
  })

  it('rejects an exchange leg without its partner', () => {
    const out = tx({ type: 'exchange_out', tradeDate: '2026-04-07', quantity: 5, linkId: 'L2' })
    expectLedgerError(() => applyLedger([tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 5, price: 1 }), out]), 'unpaired_exchange', out.id)
    const inLeg = tx({ type: 'exchange_in', tradeDate: '2026-04-07', instrumentId: 'B', quantity: 5, linkId: 'L3' })
    expectLedgerError(() => applyLedger([inLeg]), 'unpaired_exchange', inLeg.id)
  })

  it('rejects missing or non-positive values', () => {
    const zeroBuy = tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 0, price: 100 })
    expectLedgerError(() => applyLedger([zeroBuy]), 'invalid', zeroBuy.id)
    const noRatio = tx({ type: 'split', tradeDate: '2026-01-05' })
    expectLedgerError(() => applyLedger([noRatio]), 'invalid', noRatio.id)
  })

  it('reports no average cost for an empty position', () => {
    const p = applyLedger([
      tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 1, price: 1 }),
      tx({ type: 'sell', tradeDate: '2026-01-06', quantity: 1, price: 1 }),
    ]).get('A')!
    expect(averageCost(p)).toBeNull()
  })
})
