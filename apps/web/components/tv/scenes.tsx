'use client'

import { useTranslations } from 'next-intl'
import { seriesColor } from '../../lib/chart-palette.ts'
import { formatMoney, formatPercent, formatQuantity } from '../../lib/format.ts'
import { CARDS_PER_PAGE, gridShape } from '../../lib/tv-nav.ts'
import type { TvCard, TvSnapshot } from '../../lib/tv-snapshot.ts'
import { LineChart } from '../charts/line-chart.tsx'

export interface SceneProps {
  tv: TvSnapshot
  page: number
  privacy: boolean
  locale: string
  /** Chart text size in px for this screen. */
  tickSize: number
}

export const HIDDEN = '•••'
export const tone = (value: number | null) => (value === null || value === 0 ? 'text-muted' : value > 0 ? 'text-gain' : 'text-loss')

function useMoney({ tv, privacy, locale }: SceneProps) {
  return (value: number | null, signed = false) => (value === null ? '–' : privacy ? HIDDEN : formatMoney(value, tv.baseCurrency, locale, { signed }))
}

export function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.8em] font-medium uppercase tracking-[0.14em] text-muted">{children}</p>
}

export function Figure({ label, value, detail, valueClass = '' }: { label: string; value: string; detail?: string; valueClass?: string }) {
  return (
    <div className="flex flex-col gap-[0.4em] bg-surface-low p-[1.2em]">
      <Label>{label}</Label>
      <p className={`font-display text-[1.8em] font-bold leading-tight ${valueClass}`}>{value}</p>
      {detail ? <p className={`text-[0.9em] ${valueClass}`}>{detail}</p> : null}
    </div>
  )
}

export function OverviewScene(props: SceneProps) {
  const t = useTranslations('tv')
  const money = useMoney(props)
  const { tv, privacy, locale, tickSize } = props
  const { totals } = tv
  if (tv.holdings.length === 0) return <p className="m-auto max-w-[40em] text-center text-[1.4em] text-muted">{t('empty')}</p>
  const before = totals.value - totals.dayChange
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-[1.2em]">
      <div className="flex flex-col gap-[1.2em]">
        <div className="flex flex-col gap-[0.4em] bg-surface-low p-[1.4em]">
          <Label>{t('value')}</Label>
          <p data-testid="tv-total" className="font-display text-[3.6em] font-bold leading-none tracking-tight">
            {money(totals.value)}
          </p>
        </div>
        <Figure
          label={t('today')}
          value={money(totals.dayChange, true)}
          detail={before > 0 ? formatPercent(totals.dayChange / before, locale, { signed: true }) : undefined}
          valueClass={tone(totals.dayChange)}
        />
        <Figure label={t('totalReturn')} value={money(totals.totalReturn, true)} valueClass={tone(totals.totalReturn)} />
        <Figure
          label={t('unrealized')}
          value={money(totals.unrealizedGain, true)}
          detail={totals.costOfPriced > 0 ? formatPercent(totals.unrealizedGain / totals.costOfPriced, locale, { signed: true }) : undefined}
          valueClass={tone(totals.unrealizedGain)}
        />
      </div>
      <div className="flex min-h-0 flex-col gap-[0.6em] bg-surface-low p-[1.4em]">
        <Label>{t('valueYear')}</Label>
        <div className="min-h-0 flex-1">
          <LineChart
            series={[{ id: 'value', label: t('value'), color: seriesColor(0), points: tv.value1Y }]}
            format={{ kind: 'money', currency: tv.baseCurrency }}
            locale={locale}
            label={t('valueYear')}
            emptyText={t('noHistory')}
            area
            fill
            tickSize={tickSize}
            hideValues={privacy}
            interactive={false}
          />
        </div>
      </div>
    </div>
  )
}

function MoverRow({ card, money, locale }: { card: TvCard; money: (v: number | null, signed?: boolean) => string; locale: string }) {
  return (
    <li className="flex items-baseline justify-between gap-[1em] bg-surface-low px-[1.2em] py-[0.9em]">
      <span className="min-w-0">
        <span className="block truncate text-[1.2em] font-semibold">{card.name}</span>
        <span className="text-[0.8em] text-muted">{card.symbol}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className={`block font-display text-[1.6em] font-bold ${tone(card.dayChangePct)}`}>
          {card.dayChangePct === null ? '–' : formatPercent(card.dayChangePct, locale, { signed: true })}
        </span>
        <span className="text-[0.85em] text-muted">{money(card.dayChange, true)}</span>
      </span>
    </li>
  )
}

export function TodayScene(props: SceneProps) {
  const t = useTranslations('tv')
  const money = useMoney(props)
  const { tv, locale } = props
  const before = tv.totals.value - tv.totals.dayChange
  const column = (title: string, cards: TvCard[], empty: string) => (
    <section className="flex flex-col gap-[0.6em]">
      <Label>{title}</Label>
      {cards.length === 0 ? (
        <p className="text-[1em] text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-px bg-bg">
          {cards.map((c) => (
            <MoverRow key={c.instrumentId} card={c} money={money} locale={locale} />
          ))}
        </ul>
      )}
    </section>
  )
  return (
    <div className="flex h-full flex-col gap-[1.4em]">
      <div className="flex items-baseline gap-[1em]">
        <p className={`font-display text-[3.2em] font-bold leading-none ${tone(tv.totals.dayChange)}`}>{money(tv.totals.dayChange, true)}</p>
        {before > 0 ? (
          <p className={`text-[1.6em] ${tone(tv.totals.dayChange)}`}>{formatPercent(tv.totals.dayChange / before, locale, { signed: true })}</p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-[1.4em]">
        {column(t('moversUp'), tv.movers.up, t('noGainers'))}
        {column(t('moversDown'), tv.movers.down, t('noLosers'))}
      </div>
    </div>
  )
}

/** The cards of one page; the marked card (remote OK) is outlined. */
export function CardsScene(props: SceneProps & { cards: TvCard[]; mark: number | null }) {
  const t = useTranslations('tv')
  const money = useMoney(props)
  const { cards, page, privacy, locale, mark } = props
  const shown = cards.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE)
  const [columns, rows] = gridShape(shown.length)
  return (
    <ul
      className="grid h-full gap-px bg-bg"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        // Fewer, larger cards get larger text.
        fontSize: `${columns <= 2 ? 1.5 : columns === 3 ? 1.2 : 1}em`,
      }}
    >
      {shown.map((c, i) => (
        <li
          key={c.instrumentId}
          aria-current={i === mark ? 'true' : undefined}
          data-testid={i === mark ? 'tv-marked' : undefined}
          className={`flex min-h-0 flex-col justify-between gap-[0.3em] p-[1em] ${
            i === mark ? 'bg-surface-high outline outline-[0.18em] -outline-offset-[0.18em] outline-gold' : 'bg-surface-low'
          }`}
        >
          <div className="min-w-0">
            <p className="truncate text-[1.1em] font-semibold">{c.name}</p>
            <p className="truncate text-[0.85em] text-muted">
              {c.symbol}
              {privacy ? '' : ` · ${t('shares', { count: formatQuantity(c.quantity, locale) })}`}
            </p>
          </div>
          <div className="flex items-baseline justify-between gap-[0.6em]">
            <span className="truncate font-display text-[1.5em] font-bold">{c.value === null ? t('noPrice') : money(c.value)}</span>
            <span className={`shrink-0 text-[1.1em] font-semibold ${tone(c.dayChangePct)}`}>
              {c.dayChangePct === null ? '–' : formatPercent(c.dayChangePct, locale, { signed: true })}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function PerformanceScene(props: SceneProps) {
  const t = useTranslations('tv')
  const d = useTranslations('dashboard')
  const { tv, page, locale, tickSize } = props
  const current = tv.performance[Math.min(page, tv.performance.length - 1)]
  if (!current) return null
  const { view } = current
  return (
    <div className="grid h-full min-h-0 grid-cols-2 gap-[1.2em]">
      <div className="flex min-h-0 flex-col gap-[0.6em] bg-surface-low p-[1.4em]">
        <Label>
          {t('vsBenchmarks')} · {t(`range_${current.range}`)}
        </Label>
        <div className="min-h-0 flex-1">
          <LineChart
            series={view.comparison}
            format={{ kind: 'index' }}
            locale={locale}
            label={t('vsBenchmarks')}
            emptyText={t('noHistory')}
            fill
            tickSize={tickSize}
            interactive={false}
          />
        </div>
      </div>
      <div className="flex flex-col gap-[0.6em] bg-surface-low p-[1.4em]">
        <Label>{t('returns')}</Label>
        <table className="w-full whitespace-nowrap text-[0.85em]">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-[0.4em] font-normal">{d('period')}</th>
              {view.columns.map((column, i) => (
                <th key={column} className="py-[0.4em] pl-[0.8em] text-right font-normal">
                  <span className="inline-flex items-center gap-[0.4em]">
                    <span aria-hidden className="h-[0.15em] w-[0.8em]" style={{ background: view.colors[i] }} />
                    {column}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.returns.map((row) => (
              <tr key={row.period}>
                <th className="py-[0.4em] text-left font-normal text-muted">{d(`periods.${row.period}`)}</th>
                {row.values.map((value, i) => (
                  <td key={view.columns[i]} className={`py-[0.4em] pl-[0.8em] text-right tabular-nums ${i === 0 ? 'font-semibold' : ''} ${tone(value)}`}>
                    {value === null ? '–' : formatPercent(value, locale, { signed: true })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function AllocationScene(props: SceneProps) {
  const d = useTranslations('dashboard')
  const money = useMoney(props)
  const { tv, locale } = props
  const titles = { sector: d('bySector'), currency: d('byCurrency'), country: d('byCountry') }
  return (
    <div className="grid h-full grid-cols-3 gap-px bg-bg">
      {tv.allocation.map((group) => {
        const largest = Math.max(...group.slices.map((s) => s.share), 0)
        return (
          <section key={group.by} className="flex min-h-0 flex-col gap-[1em] overflow-hidden bg-surface-low p-[1.4em]">
            <Label>{titles[group.by]}</Label>
            <ul className="flex flex-col gap-[0.9em]">
              {group.slices.map((slice) => (
                <li key={slice.label} className="flex flex-col gap-[0.3em]">
                  <span className="truncate text-[1em]">{slice.label}</span>
                  <span className="flex items-center gap-[0.6em]">
                    <span aria-hidden className="h-[0.6em] rounded-r-[4px]" style={{ width: `${largest > 0 ? (slice.share / largest) * 55 : 0}%`, minWidth: 2, background: 'var(--series-1)' }} />
                    <span className="whitespace-nowrap text-[0.8em] tabular-nums text-muted">
                      {formatPercent(slice.share, locale)}
                      {props.privacy ? '' : ` · ${money(slice.value)}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
