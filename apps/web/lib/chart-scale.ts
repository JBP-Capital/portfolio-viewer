const NICE_STEPS = [1, 2, 2.5, 5, 10]

/** About `count` round tick values that cover [min, max] (0 / 500 / 1,000 rather than 0 / 411 / 822). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (max === min) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.05
    min -= pad
    max += pad
  }
  const raw = (max - min) / Math.max(1, count - 1)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = magnitude * NICE_STEPS.find((s) => s * magnitude >= raw)!
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1)
  const first = Math.floor(min / step + 1e-9)
  const last = Math.ceil(max / step - 1e-9)
  const ticks: number[] = []
  for (let i = first; i <= last; i += 1) ticks.push(Number((i * step).toFixed(decimals)) + 0)
  return ticks
}

/** Index of the value in the ascending list closest to `x`, or -1 for an empty list. */
export function nearestIndex(xs: readonly number[], x: number): number {
  if (xs.length === 0) return -1
  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid]! <= x) lo = mid
    else hi = mid
  }
  return Math.abs(xs[hi]! - x) < Math.abs(x - xs[lo]!) ? hi : lo
}

/** Up to `count` evenly spread positions in a list of `length` items, always the first and the last. */
export function evenIndices(length: number, count: number): number[] {
  if (length <= count) return Array.from({ length }, (_, i) => i)
  return Array.from({ length: count }, (_, i) => Math.round((i * (length - 1)) / (count - 1)))
}

/**
 * Where a trade sits on a thinned-out line: the first drawn point on or after its date (the point
 * whose period contains it), or the last point for a trade after the last price.
 */
export function markerPoint<T extends { date: string }>(points: readonly T[], date: string): T | null {
  return points.find((p) => p.date >= date) ?? points.at(-1) ?? null
}
