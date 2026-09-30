import { downsample } from '@pv/core'
import { getLocale, getTranslations } from 'next-intl/server'
import { seriesColor } from '../../lib/chart-palette.ts'
import { monthEnds } from '../../lib/performance.ts'
import { LineChart, type ChartPoint } from '../charts/line-chart.tsx'
import { ValueTable } from '../charts/value-table.tsx'

/** Today's holdings valued at past closes over the page's range; nothing when nothing is held. */
export async function Hypothetical({ series }: { series: { baseCurrency: string; points: ChartPoint[] } }) {
  const t = await getTranslations('dashboard')
  const locale = await getLocale()
  if (series.points.length === 0) return null

  return (
    <section className="flex flex-col gap-4 bg-surface-low p-6" aria-labelledby="hypothetical-title">
      <div className="flex flex-col gap-1">
        <h2 id="hypothetical-title" className="font-display text-lg font-semibold">
          {t('hypothetical')}
        </h2>
        <p className="text-sm text-muted">{t('hypotheticalNote')}</p>
      </div>
      <LineChart
        series={[{ id: 'hypothetical', label: t('hypothetical'), color: seriesColor(0), points: downsample(series.points) }]}
        format={{ kind: 'money', currency: series.baseCurrency }}
        locale={locale}
        label={t('hypotheticalChartLabel')}
        emptyText={t('noChartData')}
        area
      />
      <ValueTable points={monthEnds(series.points)} currency={series.baseCurrency} />
    </section>
  )
}
