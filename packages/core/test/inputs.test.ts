import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createPortfolioSchema, exchangeInputSchema, transactionInputSchema } from '../src/inputs.ts'

const ids = { portfolioId: randomUUID(), instrumentId: randomUUID() }
const buy = { ...ids, type: 'buy', tradeDate: '2026-01-05', currency: 'EUR', quantity: 10, price: 12.5 }

describe('transactionInputSchema', () => {
  it('accepts a buy and fills defaults', () => {
    expect(transactionInputSchema.parse(buy)).toMatchObject({ fees: 0, taxes: 0, fxRate: null, note: null, listingId: null })
  })
  it('rejects a buy without price or with zero quantity', () => {
    const { price: _price, ...withoutPrice } = buy
    expect(transactionInputSchema.safeParse(withoutPrice).success).toBe(false)
    expect(transactionInputSchema.safeParse({ ...buy, quantity: 0 }).success).toBe(false)
  })
  it('rejects negative fees, impossible dates and lower-case currencies', () => {
    expect(transactionInputSchema.safeParse({ ...buy, fees: -1 }).success).toBe(false)
    expect(transactionInputSchema.safeParse({ ...buy, tradeDate: '2026-02-30' }).success).toBe(false)
    expect(transactionInputSchema.safeParse({ ...buy, currency: 'eur' }).success).toBe(false)
  })
  it('requires an amount for dividends and a ratio other than 1 for splits', () => {
    expect(transactionInputSchema.safeParse({ ...ids, type: 'dividend', tradeDate: '2026-03-01', currency: 'USD' }).success).toBe(false)
    expect(transactionInputSchema.safeParse({ ...ids, type: 'dividend', tradeDate: '2026-03-01', currency: 'USD', amount: 12 }).success).toBe(true)
    expect(transactionInputSchema.safeParse({ ...ids, type: 'split', tradeDate: '2026-03-01', currency: 'USD', splitRatio: 1 }).success).toBe(false)
  })
  it('rejects fees and taxes on types where they would have no effect', () => {
    expect(transactionInputSchema.safeParse({ ...buy, type: 'transfer_in', fees: 2 }).success).toBe(false)
    expect(transactionInputSchema.safeParse({ ...buy, type: 'transfer_out', taxes: 1 }).success).toBe(false)
    expect(transactionInputSchema.safeParse({ ...ids, type: 'split', tradeDate: '2026-03-01', currency: 'USD', splitRatio: 2, fees: 1 }).success).toBe(false)
    expect(transactionInputSchema.safeParse({ ...buy, type: 'transfer_in' }).success).toBe(true)
  })

  it('limits notes to 500 characters', () => {
    expect(transactionInputSchema.safeParse({ ...buy, note: 'x'.repeat(501) }).success).toBe(false)
  })
})

describe('exchangeInputSchema', () => {
  it('requires two different securities', () => {
    const same = { portfolioId: ids.portfolioId, tradeDate: '2026-04-07', fromInstrumentId: ids.instrumentId, fromQuantity: 1000, toInstrumentId: ids.instrumentId, toQuantity: 495.9 }
    expect(exchangeInputSchema.safeParse(same).success).toBe(false)
    expect(exchangeInputSchema.safeParse({ ...same, toInstrumentId: randomUUID() }).success).toBe(true)
  })
})

describe('createPortfolioSchema', () => {
  it('trims names and rejects empty or long ones', () => {
    expect(createPortfolioSchema.parse({ name: '  Main  ' })).toEqual({ name: 'Main', color: null })
    expect(createPortfolioSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(createPortfolioSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false)
  })
})
