import { getLocale, getTranslations } from 'next-intl/server'
import { formatDate, formatMoney } from '../../lib/format.ts'
import type { ChartPoint } from './line-chart.tsx'

/** The values of a value chart as a folded table, for screen readers and exact numbers. */
export async function ValueTable({ points, currency }: { points: ChartPoint[]; currency: string }) {
  const t = await getTranslations('dashboard')
  const locale = await getLocale()
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted hover:text-text">{t('asTable')}</summary>
      <table className="mt-3 w-full">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted">
            <th scope="col" className="py-2 font-medium">
              {t('date')}
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              {t('value')}
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <td className="py-1 text-muted">{formatDate(p.date, locale)}</td>
              <td className="py-1 text-right tabular-nums">{formatMoney(p.value, currency, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
