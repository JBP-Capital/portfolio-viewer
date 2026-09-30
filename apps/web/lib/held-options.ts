import type { HeldOption } from './portfolio-types.ts'

type Position = HeldOption

/**
 * Securities offered for sells, dividends, splits, transfers out and mergers: open positions first,
 * then sold-out ones — a dividend can be paid after the last share was sold, and history may be
 * entered out of order. The ledger still refuses selling more than is held.
 */
export function heldOptions(valuation: { holdings: readonly Position[]; closed: readonly Position[] }): HeldOption[] {
  return [...valuation.holdings, ...valuation.closed].map((h) => ({
    instrumentId: h.instrumentId,
    listingId: h.listingId,
    name: h.name,
    symbol: h.symbol,
    mic: h.mic,
    currency: h.currency,
    quantity: h.quantity,
  }))
}
