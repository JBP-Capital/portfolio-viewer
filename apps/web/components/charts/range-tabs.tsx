import Link from 'next/link'
import { RANGES, type Range } from '../../lib/ranges.ts'

/** The time range of every chart and figure below it, kept in the address (`?range=`). */
export function RangeTabs({ current, basePath, label, labels }: { current: Range; basePath: string; label: string; labels: Record<Range, string> }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-px bg-bg">
      {RANGES.map((range) => (
        <Link
          key={range}
          href={`${basePath}?range=${range}`}
          scroll={false}
          aria-current={range === current ? 'page' : undefined}
          className={`min-w-12 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.08em] transition ${
            range === current ? 'bg-surface-highest text-gold' : 'bg-surface-high text-muted hover:text-text'
          }`}
        >
          {labels[range]}
        </Link>
      ))}
    </nav>
  )
}
