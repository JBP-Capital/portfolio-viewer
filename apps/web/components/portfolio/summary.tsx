import type { Valuation } from '@pv/db'
import { getLocale, getTranslations } from 'next-intl/server'
import { formatMoney } from '../../lib/format.ts'
import { Overline } from '../ui.tsx'
import { Figure, Signed } from './figures.tsx'

export async function Summary({ valuation }: { valuation: Valuation }) {
  const t = await getTranslations('portfolio')
  const locale = await getLocale()
  const { totals, baseCurrency } = valuation
  const priced = valuation.holdings.some((h) => h.value !== null)
  const previousValue = totals.value - totals.dayChange
  return (
    <section className="grid gap-px bg-bg sm:grid-cols-4">
      <div className="flex flex-col gap-2 bg-surface-low p-6 sm:col-span-2 sm:p-8">
        <Overline>{t('value')}</Overline>
        <p data-testid="portfolio-value" className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
          {priced ? formatMoney(totals.value, baseCurrency, locale) : '–'}
        </p>
        {totals.unpriced > 0 ? <p className="text-xs text-muted">{t('unpricedNote', { count: totals.unpriced })}</p> : null}
      </div>
      <Figure label={t('dayChange')}>
        <Signed value={priced ? totals.dayChange : null} currency={baseCurrency} locale={locale} base={previousValue} />
      </Figure>
      <Figure label={t('totalReturn')}>
        <Signed value={totals.totalReturn} currency={baseCurrency} locale={locale} />
      </Figure>
      <Figure label={t('cost')}>{formatMoney(totals.costOfPriced, baseCurrency, locale)}</Figure>
      <Figure label={t('unrealized')}>
        <Signed value={priced ? totals.unrealizedGain : null} currency={baseCurrency} locale={locale} base={totals.costOfPriced} />
      </Figure>
      <Figure label={t('realized')}>
        <Signed value={totals.realizedGain} currency={baseCurrency} locale={locale} />
      </Figure>
      <Figure label={t('dividends')}>
        <Signed value={totals.dividendsNet} currency={baseCurrency} locale={locale} />
      </Figure>
    </section>
  )
}
