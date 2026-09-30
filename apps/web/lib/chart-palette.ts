/**
 * Series colours in their validated order (see globals.css): the portfolio first, then the benchmarks.
 * A series keeps its slot when others are hidden, so colour follows the entity, never its rank.
 */
export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'] as const

/** Past the validated slots a series is drawn in the muted ink instead of a generated hue. */
export function seriesColor(slot: number): string {
  return SERIES_COLORS[slot] ?? 'var(--muted)'
}
