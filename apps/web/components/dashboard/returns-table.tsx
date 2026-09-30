import { getLocale, getTranslations } from 'next-intl/server'
import { formatPercent } from '../../lib/format.ts'
import type { PerformanceView } from '../../lib/performance.ts'

/** Returns per period for the portfolio and each benchmark; the table view of the comparison chart. */
export async function ReturnsTable({ view }: { view: PerformanceView }) {
  const t = await getTranslations('dashboard')
  const locale = await getLocale()
  return (
    <div className="overflow-x-auto bg-surface-low">
      <table className="w-full min-w-[36rem] text-sm">
        <caption className="sr-only">{t('returns')}</caption>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted">
            <th scope="col" className="px-6 py-4 font-medium">
              {t('period')}
            </th>
            {view.columns.map((column, i) => (
              <th key={column} scope="col" className="px-4 py-4 text-right font-medium">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="h-0.5 w-3" style={{ background: view.colors[i] }} />
                  {column}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.returns.map((row) => (
            <tr key={row.period} className="even:bg-surface">
              <th scope="row" className="px-6 py-3 text-left font-normal text-muted">
                {t(`periods.${row.period}`)}
              </th>
              {row.values.map((value, i) => (
                <td
                  key={view.columns[i]}
                  className={`px-4 py-3 text-right tabular-nums ${i === 0 ? 'font-semibold' : ''} ${value === null ? 'text-muted' : value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : ''}`}
                >
                  {value === null ? '–' : formatPercent(value, locale, { signed: true })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
