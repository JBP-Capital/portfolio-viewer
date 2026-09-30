import type { ReactNode } from 'react'
import { formatMoney, formatPercent } from '../../lib/format.ts'
import { Overline } from '../ui.tsx'

/** Money with sign and gain/loss colour, optionally followed by a percentage. */
export function Signed({ value, currency, locale, base }: { value: number | null; currency: string; locale: string; base?: number | null }) {
  if (value === null) return <span className="text-muted">–</span>
  const tone = value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : 'text-muted'
  const percent = base && base > 0 ? ` · ${formatPercent(value / base, locale, { signed: true })}` : ''
  return (
    <span className={tone}>
      {formatMoney(value, currency, locale, { signed: true })}
      {percent}
    </span>
  )
}

export function Figure({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 bg-surface-low p-6 ${className}`}>
      <Overline>{label}</Overline>
      <div className="text-lg font-semibold">{children}</div>
    </div>
  )
}
