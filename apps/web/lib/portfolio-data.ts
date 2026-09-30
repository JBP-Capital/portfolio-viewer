import { todayInTimeZone } from '@pv/core'
import { getInstrumentListing, getPortfolio, listTransactions, splitSuggestions, valuePortfolio, type Member } from '@pv/db'
import { getDb } from './db.ts'
import { heldOptions } from './held-options.ts'
import type { EditableTransaction, SelectedInstrument } from './portfolio-types.ts'

/** Everything the portfolio and position pages show, for one member's portfolio (NotFoundError otherwise). */
export async function loadPortfolioPage(member: Member, portfolioId: string) {
  const db = getDb()
  const portfolio = await getPortfolio(db, member.id, portfolioId)
  const [valuation, suggestions, rows] = await Promise.all([
    valuePortfolio(db, member.id, portfolioId),
    splitSuggestions(db, member.id, portfolioId),
    listTransactions(db, member.id, portfolioId),
  ])
  const ids = [...new Set(rows.map((r) => r.instrumentId))]
  const securities = new Map<string, SelectedInstrument>(
    await Promise.all(
      ids.map(async (id) => {
        const hit = await getInstrumentListing(db, id)
        const security: SelectedInstrument = { instrumentId: hit.instrumentId, listingId: hit.listingId, name: hit.name, symbol: hit.symbol, mic: hit.mic, currency: hit.currency }
        return [id, security] as const
      }),
    ),
  )
  const transactions: EditableTransaction[] = rows.flatMap((r) => {
    const security = securities.get(r.instrumentId)
    if (!security) return []
    return [
      {
        id: r.id,
        type: r.type,
        security,
        tradeDate: r.tradeDate,
        currency: r.currency,
        quantity: r.quantity,
        price: r.price,
        amount: r.amount,
        splitRatio: r.splitRatio,
        fees: r.fees,
        taxes: r.taxes,
        fxRate: r.fxRate,
        note: r.note,
        linkId: r.linkId,
      },
    ]
  })
  const held = heldOptions(valuation)
  return { portfolio, valuation, suggestions, transactions, held, today: todayInTimeZone(member.timezone) }
}
