'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { evenIndices, markerPoint, nearestIndex, niceTicks } from '../../lib/chart-scale.ts'
import { formatDate, formatMoney, formatPercent, formatPrice } from '../../lib/format.ts'

export interface ChartPoint {
  date: string
  value: number
}

export interface ChartSeries {
  id: string
  label: string
  /** A CSS colour, normally one of the `--series-N` tokens. */
  color: string
  points: ChartPoint[]
}

/** Buy and sell dates on a price chart. */
export interface ChartMarker {
  date: string
  label: string
}

/** Money and prices in a currency; `index` values are 100 at the start and shown as change in percent. */
export type ChartFormat = { kind: 'money'; currency: string } | { kind: 'price'; currency: string } | { kind: 'index' }

const PAD = { top: 12, right: 12, bottom: 28 }
const TICK_TEXT = 'fill-muted text-[11px]'
const time = (date: string) => Date.parse(`${date}T00:00:00Z`)
const tag = (locale: string) => (locale === 'de' ? 'de-DE' : 'en-US')

function formatValue(value: number, format: ChartFormat, locale: string): string {
  if (format.kind === 'index') return formatPercent(value / 100 - 1, locale, { signed: true })
  return format.kind === 'money' ? formatMoney(value, format.currency, locale) : formatPrice(value, format.currency, locale)
}

function formatTick(value: number, step: number, format: ChartFormat, locale: string): string {
  if (format.kind === 'index') {
    return new Intl.NumberFormat(tag(locale), { style: 'percent', maximumFractionDigits: step < 1 ? 1 : 0, signDisplay: 'exceptZero' }).format(value / 100 - 1)
  }
  const digits = step < 1 ? Math.min(4, Math.ceil(-Math.log10(step))) : 0
  return new Intl.NumberFormat(tag(locale), {
    style: 'currency',
    currency: format.currency,
    notation: Math.abs(value) >= 100_000 ? 'compact' : 'standard',
    minimumFractionDigits: digits,
    maximumFractionDigits: Math.max(digits, 1),
  }).format(value)
}

function formatAxisDate(date: string, spanDays: number, locale: string): string {
  const options: Intl.DateTimeFormatOptions =
    spanDays > 5 * 366 ? { year: 'numeric' } : spanDays > 60 ? { month: 'short', year: '2-digit' } : { day: '2-digit', month: '2-digit' }
  return new Intl.DateTimeFormat(tag(locale), { timeZone: 'UTC', ...options }).format(new Date(`${date}T00:00:00Z`))
}

/** The last point on or before `date` (series may skip days the others have). */
function pointAt(points: readonly ChartPoint[], date: string): ChartPoint | null {
  let found: ChartPoint | null = null
  for (const p of points) {
    if (p.date > date) break
    found = p
  }
  return found
}

/**
 * Line chart with a crosshair: pointer or arrow keys pick a date, the tooltip lists every series there.
 * A legend appears for two or more series; values in text never take the series colour.
 */
export function LineChart({
  series,
  format,
  locale,
  label,
  emptyText,
  area = false,
  height = 240,
  markers = [],
  fill = false,
  tickSize = 11,
  hideValues = false,
  interactive = true,
}: {
  series: ChartSeries[]
  format: ChartFormat
  locale: string
  /** Accessible name of the chart. */
  label: string
  emptyText: string
  /** A 10 % wash under a single series. */
  area?: boolean
  height?: number
  markers?: ChartMarker[]
  /** Take the height of the parent (which must have one) instead of `height`. */
  fill?: boolean
  /** Axis and legend text in px; marks grow with it (TV screens). */
  tickSize?: number
  /** Axis values and tooltip amounts hidden (privacy mode on a TV). */
  hideValues?: boolean
  /** Pointer and keyboard crosshair; off on a TV, where the remote drives the page. */
  interactive?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [measuredHeight, setMeasuredHeight] = useState(height)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setWidth(Math.max(240, Math.round(entry.contentRect.width)))
      setMeasuredHeight(Math.max(120, Math.round(entry.contentRect.height)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const visible = series.filter((s) => s.points.length > 0)
  const dates = [...new Set(visible.flatMap((s) => s.points.map((p) => p.date)))].sort()
  if (dates.length === 0) {
    return (
      <div ref={containerRef}>
        <p className="py-16 text-center text-sm text-muted">{emptyText}</p>
      </div>
    )
  }

  const chartHeight = fill ? measuredHeight : height
  const stroke = Math.max(2, tickSize / 8)
  const dot = Math.max(4, tickSize / 4)
  const padBottom = Math.max(PAD.bottom, tickSize * 2.5)
  const values = visible.flatMap((s) => s.points.map((p) => p.value))
  const ticks = niceTicks(Math.min(...values), Math.max(...values))
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1
  const tickLabels = ticks.map((t) => (hideValues ? '' : formatTick(t, step, format, locale)))
  const padLeft = hideValues ? PAD.right : Math.max(...tickLabels.map((l) => l.length)) * tickSize * 0.6 + 14
  const plotWidth = width - padLeft - PAD.right
  const plotHeight = chartHeight - PAD.top - padBottom
  const bottom = PAD.top + plotHeight
  const first = time(dates[0]!)
  const last = time(dates.at(-1)!)
  const x = (date: string) => padLeft + (last === first ? plotWidth / 2 : ((time(date) - first) / (last - first)) * plotWidth)
  const low = ticks[0]!
  const high = ticks.at(-1)!
  const y = (value: number) => PAD.top + (1 - (value - low) / (high - low)) * plotHeight
  const xs = dates.map(x)
  const line = (points: readonly ChartPoint[]) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join('')
  const spanDays = (last - first) / 86_400_000

  const activeDate = active === null ? null : (dates[active] ?? null)
  const rows = activeDate === null ? [] : visible.map((s) => ({ s, point: pointAt(s.points, activeDate) }))
  const activeMarkers =
    activeDate === null
      ? []
      : markers.filter((m) => (m.date <= activeDate || active === dates.length - 1) && (active === 0 || m.date > dates[(active ?? 0) - 1]!))
  const anchor = visible[0]!

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setActive(nearestIndex(xs, ((event.clientX - box.left) / box.width) * width))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const end = dates.length - 1
    const current = active ?? end
    const next =
      event.key === 'ArrowLeft' ? Math.max(0, current - 1) : event.key === 'ArrowRight' ? Math.min(end, current + 1) : event.key === 'Home' ? 0 : event.key === 'End' ? end : null
    if (next === null) return
    event.preventDefault()
    setActive(next)
  }
  const tooltipLeft = activeDate === null ? 0 : xs[active!]!
  const flip = tooltipLeft > width * 0.6
  const shown = (value: number) => (hideValues ? '•••' : formatValue(value, format, locale))
  const tickStyle = { fontSize: tickSize }

  return (
    <div className={`flex flex-col gap-3 ${fill ? 'h-full min-h-0' : ''}`}>
      {visible.length > 1 ? (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" style={tickSize === 11 ? undefined : tickStyle}>
          {visible.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span aria-hidden className="h-0.5 w-4" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div
        ref={containerRef}
        role="img"
        aria-label={label}
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={interactive ? onKeyDown : undefined}
        onFocus={interactive ? () => setActive((a) => a ?? dates.length - 1) : undefined}
        onBlur={interactive ? () => setActive(null) : undefined}
        className={`relative outline-none focus-visible:ring-1 focus-visible:ring-gold ${fill ? 'min-h-0 flex-1 overflow-hidden' : ''}`}
      >
        <svg
          viewBox={`0 0 ${width} ${chartHeight}`}
          width="100%"
          height={chartHeight}
          className="block touch-pan-y"
          onPointerMove={interactive ? onPointerMove : undefined}
          onPointerDown={interactive ? onPointerMove : undefined}
          onPointerLeave={interactive ? () => setActive(null) : undefined}
        >
          {ticks.map((t, i) => (
            <g key={t}>
              <line x1={padLeft} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={padLeft - 8} y={y(t)} dy="0.32em" textAnchor="end" className={TICK_TEXT} style={tickStyle}>
                {tickLabels[i]}
              </text>
            </g>
          ))}
          {evenIndices(dates.length, width < 480 ? 3 : 5).map((i) => (
            <text
              key={i}
              x={xs[i]}
              y={chartHeight - Math.max(8, tickSize * 0.7)}
              textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
              className={TICK_TEXT}
              style={tickStyle}
            >
              {formatAxisDate(dates[i]!, spanDays, locale)}
            </text>
          ))}
          {area && visible.length === 1 ? (
            <path
              d={`${line(anchor.points)}L${x(anchor.points.at(-1)!.date).toFixed(1)},${bottom}L${x(anchor.points[0]!.date).toFixed(1)},${bottom}Z`}
              fill={anchor.color}
              fillOpacity={0.1}
            />
          ) : null}
          {visible.map((s) => (
            <path key={s.id} d={line(s.points)} fill="none" stroke={s.color} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {markers.map((m) => {
            const p = markerPoint(anchor.points, m.date)
            return p ? <circle key={`${m.date}-${m.label}`} cx={x(p.date)} cy={y(p.value)} r={dot} fill={anchor.color} stroke="var(--surface-low)" strokeWidth={2} /> : null
          })}
          {activeDate === null ? (
            visible.map((s) => {
              const end = s.points.at(-1)!
              return <circle key={s.id} cx={x(end.date)} cy={y(end.value)} r={dot} fill={s.color} stroke="var(--surface-low)" strokeWidth={2} />
            })
          ) : (
            <g>
              <line x1={tooltipLeft} x2={tooltipLeft} y1={PAD.top} y2={bottom} stroke="var(--muted)" strokeWidth={1} />
              {rows.map(({ s, point }) =>
                point ? <circle key={s.id} cx={tooltipLeft} cy={y(point.value)} r={4} fill={s.color} stroke="var(--surface-low)" strokeWidth={2} /> : null,
              )}
            </g>
          )}
        </svg>
        {activeDate !== null ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 z-10 min-w-40 bg-surface-highest px-3 py-2 text-xs shadow-lg"
            style={{ left: tooltipLeft, transform: flip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
          >
            <p className="mb-1 text-muted">{formatDate(activeDate, locale)}</p>
            {rows.map(({ s, point }) => (
              <p key={s.id} className="flex items-center gap-2 whitespace-nowrap">
                <span aria-hidden className="h-0.5 w-3 shrink-0" style={{ background: s.color }} />
                <span className="font-semibold text-text">{point ? shown(point.value) : '–'}</span>
                {visible.length > 1 ? <span className="text-muted">{s.label}</span> : null}
              </p>
            ))}
            {activeMarkers.map((m) => (
              <p key={`${m.date}-${m.label}`} className="mt-1 whitespace-nowrap text-muted">
                {m.label}
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {activeDate === null
          ? ''
          : [formatDate(activeDate, locale), ...rows.map(({ s, point }) => `${s.label} ${point ? shown(point.value) : '–'}`), ...activeMarkers.map((m) => m.label)].join(', ')}
      </p>
    </div>
  )
}
