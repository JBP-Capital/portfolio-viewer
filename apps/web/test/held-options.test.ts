import { describe, expect, it } from 'vitest'
import { heldOptions } from '../lib/held-options.ts'

const position = (instrumentId: string, quantity: number) => ({
  instrumentId, listingId: `l-${instrumentId}`, name: instrumentId.toUpperCase(), symbol: instrumentId, mic: 'XNYS', currency: 'USD', quantity,
})

describe('heldOptions', () => {
  it('offers open positions first, then sold-out ones (a dividend can arrive after the sale)', () => {
    const options = heldOptions({ holdings: [position('aem', 10)], closed: [position('sap', 0)] })
    expect(options.map((o) => [o.instrumentId, o.quantity])).toEqual([['aem', 10], ['sap', 0]])
    expect(options[1]).toEqual({ instrumentId: 'sap', listingId: 'l-sap', name: 'SAP', symbol: 'sap', mic: 'XNYS', currency: 'USD', quantity: 0 })
  })
})
