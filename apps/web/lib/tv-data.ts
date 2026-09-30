import { addMonths } from '@pv/core'
import { listingsPrices, listPortfolios, memberSeries, valueMember, type Member } from '@pv/db'
import { getTranslations } from 'next-intl/server'
import { getDb } from './db.ts'
import { allocationLabel } from './display-names.ts'
import { buildTvSnapshot, type TvSnapshot } from './tv-snapshot.ts'

/** The TV's data for one member, in the member's language, through the same repositories as the dashboard. */
export async function loadTvSnapshot(member: Member): Promise<TvSnapshot> {
  const db = getDb()
  const [portfolios, total, series, d] = await Promise.all([
    listPortfolios(db, member.id),
    valueMember(db, member.id),
    memberSeries(db, member.id, null),
    getTranslations({ locale: member.locale, namespace: 'dashboard' }),
  ])
  const words = { unknown: d('unknown'), other: d('other') }
  const prices = await listingsPrices(db, [...new Set(total.holdings.map((h) => h.listingId))], addMonths(series.to, -12), series.to)
  return buildTvSnapshot({
    total,
    portfolios: portfolios.map((p) => ({ id: p.id, name: p.name })),
    series,
    prices,
    memberName: member.displayName,
    portfolioLabel: d('portfolio'),
    allocationLabel: (by, slice) => allocationLabel(by, slice, member.locale, words),
  })
}
