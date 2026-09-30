import type { SeriesResult } from '@pv/db'
import { getLocale, getTranslations } from 'next-intl/server'
import { seriesColor } from '../../lib/chart-palette.ts'
import { buildPerformance } from '../../lib/performance.ts'
import { RANGES, type Range } from '../../lib/ranges.ts'
import { LineChart } from '../charts/line-chart.tsx'
import { RangeTabs } from '../charts/range-tabs.tsx'
import { ValueTable } from '../charts/value-table.tsx'
import { Overline } from '../ui.tsx'
import { ReturnsTable } from './returns-table.tsx'

/** Value history, the comparison with benchmarks and the returns table, all for one range. */
export async function Performance({ series, range, basePath }: { series: SeriesResult; range: Range; basePath: string }) {
  const t = await getTranslations('dashboard')
  const locale = await getLocale()
  const view = buildPerformance(series, range, t('portfolio'))
  const labels = Object.fromEntries(RANGES.map((r) => [r, t(`range.${r}`)])) as Record<Range, string>
  const money = { kind: 'money', currency: series.baseCurrency } as const

  return (
    <section className="flex flex-col gap-4" aria-label={t('performance')}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Overline>{t('performance')}</Overline>
        <RangeTabs current={range} basePath={basePath} label={t('rangeLabel')} labels={labels} />
      </div>
      {view === null ? (
        <p className="bg-surface-low px-6 py-5 text-muted">{t('noHistory')}</p>
      ) : (
        <>
          <div className="grid gap-px bg-bg xl:grid-cols-2">
            <div className="flex flex-col gap-4 bg-surface-low p-6">
              <h2 className="font-display text-lg font-semibold">{t('valueHistory')}</h2>
              <LineChart
                series={[{ id: 'value', label: t('valueHistory'), color: seriesColor(0), points: view.value }]}
                format={money}
                locale={locale}
                label={t('valueChartLabel')}
                emptyText={t('noChartData')}
                area
              />
              <ValueTable points={view.monthEnds} currency={series.baseCurrency} />
            </div>
            <div className="flex flex-col gap-4 bg-surface-low p-6">
              <h2 className="font-display text-lg font-semibold">{t('vsBenchmarks')}</h2>
              <LineChart series={view.comparison} format={{ kind: 'index' }} locale={locale} label={t('comparisonChartLabel')} emptyText={t('noChartData')} />
            </div>
          </div>
          <ReturnsTable view={view} />
          <p className="text-xs text-muted">{t('benchmarkNote')}</p>
        </>
      )}
    </section>
  )
}
