export const TRANSACTION_TYPES = [
  'buy',
  'sell',
  'dividend',
  'transfer_in',
  'transfer_out',
  'split',
  'exchange_out',
  'exchange_in',
] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

/** One recorded transaction; amounts are in the transaction currency, `fxRate` converts to base. */
export interface LedgerTransaction {
  id: string
  instrumentId: string
  type: TransactionType
  tradeDate: string
  quantity: number | null
  price: number | null
  /** Base currency units per one unit of the transaction currency on the trade date. */
  fxRate: number
  fees: number
  taxes: number
  /** Dividends: gross amount. */
  amount: number | null
  /** Splits: new shares per old share. */
  splitRatio: number | null
  /** Pairs the two legs of an exchange (merger). */
  linkId: string | null
  /** ISO timestamp; orders transactions of the same day and type. */
  createdAt: string
  /** A transfer between two portfolios of the same member: in a combined view no money moves. */
  internal?: boolean
}

/** State of one security in one portfolio. All amounts are in base currency. */
export interface PositionState {
  instrumentId: string
  quantity: number
  costBasis: number
  /** Before taxes. */
  realizedGain: number
  dividendsGross: number
  dividendsNet: number
  feesPaid: number
  taxesPaid: number
}

export type LedgerErrorCode = 'oversell' | 'unpaired_exchange' | 'invalid'

export class LedgerError extends Error {
  readonly code: LedgerErrorCode
  readonly transactionId: string
  /** For 'oversell': the quantity held on that date. */
  readonly held: number | undefined

  constructor(code: LedgerErrorCode, transactionId: string, message: string, held?: number) {
    super(message)
    this.name = 'LedgerError'
    this.code = code
    this.transactionId = transactionId
    this.held = held
  }
}

const EPSILON = 1e-9

// Within one day: splits first, then exchanges, then money coming in, then money going out.
const SAME_DAY_ORDER: Record<TransactionType, number> = {
  split: 0,
  exchange_out: 1,
  exchange_in: 2,
  buy: 3,
  transfer_in: 3,
  dividend: 4,
  sell: 5,
  transfer_out: 5,
}

export function sortTransactions(txs: readonly LedgerTransaction[]): LedgerTransaction[] {
  return [...txs].sort(
    (a, b) =>
      a.tradeDate.localeCompare(b.tradeDate) ||
      SAME_DAY_ORDER[a.type] - SAME_DAY_ORDER[b.type] ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  )
}

export function averageCost(p: PositionState): number | null {
  return p.quantity > EPSILON ? p.costBasis / p.quantity : null
}

function emptyPosition(instrumentId: string): PositionState {
  return { instrumentId, quantity: 0, costBasis: 0, realizedGain: 0, dividendsGross: 0, dividendsNet: 0, feesPaid: 0, taxesPaid: 0 }
}

function positive(tx: LedgerTransaction, field: 'quantity' | 'amount' | 'splitRatio'): number {
  const value = tx[field]
  if (value === null || !Number.isFinite(value) || value <= 0) {
    throw new LedgerError('invalid', tx.id, `${tx.type} on ${tx.tradeDate} needs a positive ${field}`)
  }
  return value
}

function nonNegativePrice(tx: LedgerTransaction): number {
  if (tx.price === null || !Number.isFinite(tx.price) || tx.price < 0) {
    throw new LedgerError('invalid', tx.id, `${tx.type} on ${tx.tradeDate} needs a price of zero or more`)
  }
  return tx.price
}

/** Removes shares at average cost and returns the cost basis that left the position. */
function removeShares(p: PositionState, quantity: number, tx: LedgerTransaction): number {
  if (quantity > p.quantity + EPSILON) {
    throw new LedgerError('oversell', tx.id, `Cannot remove ${quantity} shares on ${tx.tradeDate}: only ${p.quantity} held`, Math.max(p.quantity, 0))
  }
  const costRemoved = p.quantity > EPSILON ? p.costBasis * (Math.min(quantity, p.quantity) / p.quantity) : 0
  p.quantity -= quantity
  p.costBasis -= costRemoved
  if (p.quantity < EPSILON) {
    p.quantity = 0
    p.costBasis = 0
  }
  return costRemoved
}

export interface Ledger {
  apply(tx: LedgerTransaction): void
  readonly positions: Map<string, PositionState>
  /** Throws when an exchange_out never met its exchange_in. */
  assertClosed(): void
}

/** An incremental ledger; transactions must be applied in `sortTransactions` order. */
export function createLedger(): Ledger {
  const positions = new Map<string, PositionState>()
  const pendingExchanges = new Map<string, { cost: number; transactionId: string }>()

  function position(instrumentId: string): PositionState {
    let p = positions.get(instrumentId)
    if (!p) {
      p = emptyPosition(instrumentId)
      positions.set(instrumentId, p)
    }
    return p
  }

  function apply(tx: LedgerTransaction): void {
    const p = position(tx.instrumentId)
    const fx = tx.fxRate
    switch (tx.type) {
      case 'buy':
      case 'transfer_in': {
        const quantity = positive(tx, 'quantity')
        const price = nonNegativePrice(tx)
        // Purchase costs (fees, stamp duty, transaction taxes) belong to the cost basis.
        const fees = tx.type === 'buy' ? tx.fees : 0
        const taxes = tx.type === 'buy' ? tx.taxes : 0
        p.quantity += quantity
        p.costBasis += (quantity * price + fees + taxes) * fx
        p.feesPaid += fees * fx
        p.taxesPaid += taxes * fx
        break
      }
      case 'sell': {
        const quantity = positive(tx, 'quantity')
        const price = nonNegativePrice(tx)
        const cost = removeShares(p, quantity, tx)
        p.realizedGain += (quantity * price - tx.fees) * fx - cost
        p.feesPaid += tx.fees * fx
        p.taxesPaid += tx.taxes * fx
        break
      }
      case 'transfer_out':
        removeShares(p, positive(tx, 'quantity'), tx)
        break
      case 'split':
        p.quantity *= positive(tx, 'splitRatio')
        break
      case 'dividend': {
        const amount = positive(tx, 'amount')
        p.dividendsGross += amount * fx
        p.dividendsNet += (amount - tx.taxes) * fx
        p.taxesPaid += tx.taxes * fx
        break
      }
      case 'exchange_out': {
        if (!tx.linkId) throw new LedgerError('unpaired_exchange', tx.id, 'An exchange_out needs a link to its exchange_in')
        const cost = removeShares(p, positive(tx, 'quantity'), tx)
        pendingExchanges.set(tx.linkId, { cost, transactionId: tx.id })
        break
      }
      case 'exchange_in': {
        const pending = tx.linkId ? pendingExchanges.get(tx.linkId) : undefined
        if (!tx.linkId || !pending) {
          throw new LedgerError('unpaired_exchange', tx.id, 'An exchange_in needs an exchange_out on or before its date')
        }
        pendingExchanges.delete(tx.linkId)
        p.quantity += positive(tx, 'quantity')
        p.costBasis += pending.cost
        break
      }
    }
  }

  function assertClosed(): void {
    for (const pending of pendingExchanges.values()) {
      throw new LedgerError('unpaired_exchange', pending.transactionId, 'An exchange_out has no matching exchange_in')
    }
  }

  return { apply, positions, assertClosed }
}

/** Applies all transactions of one portfolio and returns the state per security. */
export function applyLedger(txs: readonly LedgerTransaction[]): Map<string, PositionState> {
  const ledger = createLedger()
  for (const tx of sortTransactions(txs)) ledger.apply(tx)
  ledger.assertClosed()
  return ledger.positions
}
