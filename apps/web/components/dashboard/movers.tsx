import type { Holding } from '@pv/db'
import { getLocale, getTranslations } from 'next-intl/server'
import { formatMoney, formatPercent } from '../../lib/format.ts'
import { Overline } from '../ui.tsx'

const COUNT = 3

/** Today's three largest rises and falls among priced holdings, in percent. */
export async function Movers({ holdings, currency }: { holdings: Holding[]; currency: string }) {
  const t = await getTranslations('dashboard')
  const locale = await getLocale()
  const moves = holdings.flatMap((h) => {
    if (h.value === null || h.dayChange === null || h.value - h.dayChange <= 0) return []
    return [{ holding: h, change: h.dayChange / (h.value - h.dayChange) }]
  })
  const up = moves.filter((m) => m.change > 0).sort((a, b) => b.change - a.change).slice(0, COUNT)
  const down = moves.filter((m) => m.change < 0).sort((a, b) => a.change - b.change).slice(0, COUNT)
  const column = (title: string, list: typeof moves) => (
    <div className="flex flex-col gap-4 bg-surface-low p-6">
      <Overline>{title}</Overline>
      {list.length === 0 ? (
        <p className="text-sm text-muted">{t('noMovers')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map(({ holding, change }) => (
            <li key={holding.instrumentId} className="flex items-baseline justify-between gap-4 text-sm">
              <span className="truncate">{holding.name}</span>
              <span className="shrink-0 text-right tabular-nums">
                <span className={change > 0 ? 'text-gain' : 'text-loss'}>{formatPercent(change, locale, { signed: true })}</span>
                <span className="ml-3 text-muted">{formatMoney(holding.dayChange!, currency, locale, { signed: true })}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
  return (
    <section className="flex flex-col gap-4">
      <Overline>{t('movers')}</Overline>
      <div className="grid gap-px bg-bg md:grid-cols-2">
        {column(t('moversUp'), up)}
        {column(t('moversDown'), down)}
      </div>
    </section>
  )
}
