import type { AllocationSlice } from '@pv/db'
import { formatMoney, formatPercent } from '../../lib/format.ts'
import { Overline } from '../ui.tsx'

/** Shares of the portfolio value as horizontal bars, the share at each bar's tip. */
export function AllocationBars({
  title,
  slices,
  labelFor,
  currency,
  locale,
}: {
  title: string
  slices: AllocationSlice[]
  labelFor: (slice: AllocationSlice) => string
  currency: string
  locale: string
}) {
  const largest = Math.max(...slices.map((s) => s.share), 0)
  return (
    <div className="flex flex-col gap-5 bg-surface-low p-6">
      <Overline>{title}</Overline>
      <ul className="flex flex-col gap-4">
        {slices.map((slice) => (
          <li key={`${slice.kind}:${slice.key}`} className="flex flex-col gap-1.5">
            <span className="text-sm">{labelFor(slice)}</span>
            <span className="flex items-center gap-3">
              <span
                aria-hidden
                className="h-3 rounded-r-[4px]"
                style={{ width: `${largest > 0 ? (slice.share / largest) * 55 : 0}%`, minWidth: 2, background: 'var(--series-1)' }}
              />
              <span className="whitespace-nowrap text-xs tabular-nums text-muted">
                {formatPercent(slice.share, locale)} · {formatMoney(slice.value, currency, locale)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
