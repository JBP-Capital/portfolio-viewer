'use client'

import { useTranslations } from 'next-intl'
import { seriesColor } from '../../lib/chart-palette.ts'
import { formatMoney, formatPercent, formatPrice, formatQuantity } from '../../lib/format.ts'
import type { TvCard } from '../../lib/tv-snapshot.ts'
import { LineChart } from '../charts/line-chart.tsx'
import { Figure, HIDDEN, Label, tone, type SceneProps } from './scenes.tsx'

/** One security full screen: its figures and a year of prices in the listing's currency. */
export function DetailScene(props: SceneProps & { card: TvCard }) {
  const t = useTranslations('tv')
  const { tv, card, privacy, locale, tickSize } = props
  const money = (value: number | null, signed = false) => (value === null ? '–' : privacy ? HIDDEN : formatMoney(value, tv.baseCurrency, locale, { signed }))
  const percent = (value: number | null) => (value === null ? undefined : formatPercent(value, locale, { signed: true }))
  return (
    <div data-testid="tv-detail" className="grid h-full min-h-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-[1.2em]">
      <div className="flex min-h-0 flex-col gap-[1.2em]">
        <div className="flex flex-col gap-[0.3em] bg-surface-low p-[1.4em]">
          <h2 className="font-display text-[2.2em] font-bold leading-tight tracking-tight">{card.name}</h2>
          <p className="text-[1em] text-muted">
            {card.symbol}
            {privacy ? '' : ` · ${t('shares', { count: formatQuantity(card.quantity, locale) })}`}
          </p>
        </div>
        <Figure
          label={t('positionValue')}
          value={card.value === null ? t('noPrice') : money(card.value)}
          detail={card.price === null ? undefined : `${t('price')} ${formatPrice(card.price, card.currency, locale)}`}
        />
        <Figure label={t('today')} value={money(card.dayChange, true)} detail={percent(card.dayChangePct)} valueClass={tone(card.dayChangePct)} />
        <Figure label={t('unrealized')} value={money(card.unrealizedGain, true)} detail={percent(card.unrealizedPct)} valueClass={tone(card.unrealizedGain)} />
      </div>
      <div className="flex min-h-0 flex-col gap-[0.6em] bg-surface-low p-[1.4em]">
        <Label>{t('priceYear')}</Label>
        <div className="min-h-0 flex-1">
          <LineChart
            series={[{ id: 'price', label: t('price'), color: seriesColor(0), points: tv.prices[card.listingId] ?? [] }]}
            format={{ kind: 'price', currency: card.currency }}
            locale={locale}
            label={t('priceYear')}
            emptyText={t('noHistory')}
            area
            fill
            tickSize={tickSize}
            interactive={false}
          />
        </div>
      </div>
    </div>
  )
}
