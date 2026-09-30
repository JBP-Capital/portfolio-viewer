/** A security as the transaction form knows it. */
export interface SelectedInstrument {
  instrumentId: string
  listingId: string
  name: string
  symbol: string
  mic: string
  currency: string
}

/** A security held in the portfolio, offered for sells, dividends, splits and mergers. */
export interface HeldOption extends SelectedInstrument {
  quantity: number
}

/** A stored transaction, prepared for the edit form (numbers stay numbers). */
export interface EditableTransaction {
  id: string
  type: string
  security: SelectedInstrument
  tradeDate: string
  currency: string
  quantity: number | null
  price: number | null
  amount: number | null
  splitRatio: number | null
  fees: number
  taxes: number
  fxRate: number | null
  note: string | null
  linkId: string | null
}
