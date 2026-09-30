import { describe, expect, it } from 'vitest'
import type { LedgerTransaction } from '../src/ledger.ts'
import { periodReturn, periodStart, valuationSeries, type CloseLookup } from '../src/returns.ts'

let seq = 0
function tx(partial: Partial<LedgerTransaction> & Pick<LedgerTransaction, 'type' | 'tradeDate'>): LedgerTransaction {
  seq += 1
  return {
    id: `r${seq}`, instrumentId: 'A', quantity: null, price: null, fxRate: 1, fees: 0, taxes: 0,
    amount: null, splitRatio: null, linkId: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, seq)).toISOString(), ...partial,
  }
}

function closes(table: Record<string, Record<string, number>>): CloseLookup {
  return (instrumentId, date) => table[instrumentId]?.[date] ?? null
}

function byDate(points: ReturnType<typeof valuationSeries>, date: string) {
  const point = points.find((p) => p.date === date)
  if (!point) throw new Error(`no point for ${date}`)
  return point
}

describe('valuationSeries', () => {
  it('values a single buy and chains daily returns', () => {
    const points = valuationSeries(
      [tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 })],
      '2026-01-04', '2026-01-06',
      closes({ A: { '2026-01-05': 101, '2026-01-06': 102.1 } }),
    )
    expect(byDate(points, '2026-01-04')).toMatchObject({ value: 0, dailyReturn: 0 })
    expect(byDate(points, '2026-01-05').flowIn).toBeCloseTo(1000, 9)
    expect(byDate(points, '2026-01-05').dailyReturn).toBeCloseTo(0.01, 9)
    expect(byDate(points, '2026-01-06').dailyReturn).toBeCloseTo(1021 / 1010 - 1, 9)
    expect(periodReturn(points, 'MAX', '2026-01-06')).toBeCloseTo(0.021, 9)
  })

  it('counts a buy as money in at the start of the day', () => {
    const points = valuationSeries(
      [
        tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 }),
        tx({ type: 'buy', tradeDate: '2026-01-06', quantity: 10, price: 110 }),
      ],
      '2026-01-05', '2026-01-06',
      closes({ A: { '2026-01-05': 100, '2026-01-06': 110 } }),
    )
    expect(byDate(points, '2026-01-06').dailyReturn).toBeCloseTo(2200 / 2100 - 1, 9)
  })

  it('counts a sell as money out at the end of the day', () => {
    const points = valuationSeries(
      [
        tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 }),
        tx({ type: 'sell', tradeDate: '2026-01-06', quantity: 10, price: 101 }),
      ],
      '2026-01-05', '2026-01-06',
      closes({ A: { '2026-01-05': 100, '2026-01-06': 102 } }),
    )
    expect(byDate(points, '2026-01-06')).toMatchObject({ value: 0 })
    expect(byDate(points, '2026-01-06').dailyReturn).toBeCloseTo(0.01, 9)
  })

  it('treats a dividend and the matching price drop as neutral', () => {
    const points = valuationSeries(
      [
        tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 }),
        tx({ type: 'dividend', tradeDate: '2026-01-06', amount: 20 }),
      ],
      '2026-01-05', '2026-01-06',
      closes({ A: { '2026-01-05': 100, '2026-01-06': 98 } }),
    )
    expect(byDate(points, '2026-01-06').dailyReturn).toBeCloseTo(0, 9)
  })

  it('keeps the value continuous over a split with unadjusted closes', () => {
    const points = valuationSeries(
      [
        tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 }),
        tx({ type: 'split', tradeDate: '2026-01-06', splitRatio: 2 }),
      ],
      '2026-01-05', '2026-01-06',
      closes({ A: { '2026-01-05': 100, '2026-01-06': 50 } }),
    )
    expect(byDate(points, '2026-01-06')).toMatchObject({ value: 1000 })
    expect(byDate(points, '2026-01-06').dailyReturn).toBeCloseTo(0, 9)
  })

  it('adds a holding whose price appears later without a fake gain', () => {
    const points = valuationSeries(
      [
        tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 }),
        tx({ type: 'buy', tradeDate: '2026-01-05', instrumentId: 'B', quantity: 5, price: 20 }),
      ],
      '2026-01-05', '2026-01-07',
      closes({ A: { '2026-01-05': 100, '2026-01-06': 100, '2026-01-07': 100 }, B: { '2026-01-07': 25 } }),
    )
    expect(byDate(points, '2026-01-05')).toMatchObject({ value: 1000, flowIn: 1000 })
    expect(byDate(points, '2026-01-07')).toMatchObject({ value: 1125, flowIn: 125 })
    expect(byDate(points, '2026-01-07').dailyReturn).toBeCloseTo(0, 9)
  })

  it('removes a holding whose price disappears without a fake loss', () => {
    const points = valuationSeries(
      [tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 })],
      '2026-01-05', '2026-01-07',
      closes({ A: { '2026-01-05': 100, '2026-01-06': 100 } }),
    )
    expect(byDate(points, '2026-01-07')).toMatchObject({ value: 0, flowOut: 1000 })
    expect(byDate(points, '2026-01-07').dailyReturn).toBeCloseTo(0, 9)
  })

  it('values a transfer in at market, not at its old cost', () => {
    const points = valuationSeries(
      [tx({ type: 'transfer_in', tradeDate: '2026-01-05', quantity: 10, price: 50 })],
      '2026-01-05', '2026-01-05',
      closes({ A: { '2026-01-05': 100 } }),
    )
    expect(byDate(points, '2026-01-05')).toMatchObject({ value: 1000, flowIn: 1000 })
    expect(byDate(points, '2026-01-05').dailyReturn).toBeCloseTo(0, 9)
  })

  it('counts fees and taxes of a buy as money in', () => {
    const points = valuationSeries(
      [tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100, fees: 5, taxes: 3 })],
      '2026-01-05', '2026-01-05',
      closes({ A: { '2026-01-05': 100 } }),
    )
    expect(byDate(points, '2026-01-05').flowIn).toBeCloseTo(1008, 9)
  })

  it('converts buy cash flows with the transaction fx rate', () => {
    const points = valuationSeries(
      [tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100, fxRate: 0.5 })],
      '2026-01-05', '2026-01-05',
      closes({ A: { '2026-01-05': 51 } }),
    )
    expect(byDate(points, '2026-01-05').flowIn).toBeCloseTo(500, 9)
    expect(byDate(points, '2026-01-05').dailyReturn).toBeCloseTo(0.02, 9)
  })
})

describe('periods', () => {
  it('computes period start dates', () => {
    expect(periodStart('1D', '2026-03-15')).toBe('2026-03-14')
    expect(periodStart('MTD', '2026-03-15')).toBe('2026-02-28')
    expect(periodStart('YTD', '2026-03-15')).toBe('2025-12-31')
    expect(periodStart('1Y', '2026-03-15')).toBe('2025-03-15')
    expect(periodStart('MAX', '2026-03-15')).toBeNull()
  })

  it('chains returns inside a period and refuses periods longer than the history', () => {
    const points = valuationSeries(
      [tx({ type: 'buy', tradeDate: '2026-01-29', quantity: 10, price: 100 })],
      '2026-01-28', '2026-02-03',
      closes({ A: { '2026-01-29': 100, '2026-01-30': 100, '2026-01-31': 110, '2026-02-01': 110, '2026-02-02': 121, '2026-02-03': 121 } }),
    )
    expect(periodReturn(points, 'MTD', '2026-02-03')).toBeCloseTo(0.1, 9)
    expect(periodReturn(points, '1D', '2026-02-03')).toBeCloseTo(0, 9)
    expect(periodReturn(points, 'MAX', '2026-02-03')).toBeCloseTo(0.21, 9)
    expect(periodReturn(points, 'YTD', '2026-02-03')).toBeNull()
    expect(periodReturn(points, '1W', '2026-02-03')).toBeNull()
  })

  it('counts a period as covered when only weekends and New Year lie between its start and the first trade', () => {
    const prices = closes({
      A: { '2026-01-02': 100, '2026-01-03': 100, '2026-01-04': 100, '2026-01-05': 110, '2026-01-06': 110, '2026-01-07': 110, '2026-01-08': 110, '2026-01-09': 110, '2026-01-10': 110 },
    })
    const fromJan2 = valuationSeries([tx({ type: 'buy', tradeDate: '2026-01-02', quantity: 10, price: 100 })], '2026-01-02', '2026-01-10', prices)
    expect(periodReturn(fromJan2, 'YTD', '2026-01-06')).toBeCloseTo(0.1, 9)
    const fromJan5 = valuationSeries([tx({ type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 110 })], '2026-01-05', '2026-01-10', prices)
    // Friday 2 January was a trading day before the first trade.
    expect(periodReturn(fromJan5, 'YTD', '2026-01-06')).toBeNull()
    // A week back from Saturday 10 January starts on Saturday 3 January; only Sunday lies before Monday's trade.
    expect(periodReturn(fromJan5, '1W', '2026-01-10')).toBeCloseTo(0, 9)
  })
})

describe('moves between own portfolios', () => {
  const prices = closes({ 'P1|A': { '2026-01-05': 100, '2026-01-06': 110 }, 'P2|A': { '2026-01-05': 100, '2026-01-06': 110 } })
  const buy = tx({ instrumentId: 'P1|A', type: 'buy', tradeDate: '2026-01-05', quantity: 10, price: 100 })

  it('carry no money in or out, so the day return is the price change', () => {
    const points = valuationSeries(
      [
        buy,
        tx({ instrumentId: 'P1|A', type: 'transfer_out', tradeDate: '2026-01-06', quantity: 10, internal: true }),
        tx({ instrumentId: 'P2|A', type: 'transfer_in', tradeDate: '2026-01-06', quantity: 10, price: 100, internal: true }),
      ],
      '2026-01-05', '2026-01-06', prices,
    )
    expect(byDate(points, '2026-01-06')).toMatchObject({ value: 1100, flowIn: 0, flowOut: 0 })
    expect(byDate(points, '2026-01-06').dailyReturn).toBeCloseTo(0.1, 9)
  })

  it('count as flows when they are not marked as a move', () => {
    const points = valuationSeries(
      [
        buy,
        tx({ instrumentId: 'P1|A', type: 'transfer_out', tradeDate: '2026-01-06', quantity: 10 }),
        tx({ instrumentId: 'P2|A', type: 'transfer_in', tradeDate: '2026-01-06', quantity: 10, price: 100 }),
      ],
      '2026-01-05', '2026-01-06', prices,
    )
    expect(byDate(points, '2026-01-06').dailyReturn).toBeCloseTo(2200 / 2100 - 1, 9)
  })
})
