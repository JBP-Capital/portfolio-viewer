import { toMajorUnit } from '@pv/core'
import type { Holding } from './holdings.ts'

export interface AllocationSlice {
  /** Sector name, currency code or ISO country; empty for the unknown and other groups. */
  key: string
  kind: 'group' | 'unknown' | 'other'
  /** Base currency. */
  value: number
  /** Part of the priced total, 0–1. */
  share: number
}

/** Priced holdings grouped by value, largest first; past `maxGroups` the smallest fold into one "other" slice. */
export function allocation(holdings: readonly Holding[], by: 'sector' | 'currency' | 'country', maxGroups = 7): AllocationSlice[] {
  const groups = new Map<string, number>()
  for (const h of holdings) {
    if (h.value === null || h.value <= 0) continue
    const key = by === 'currency' ? toMajorUnit(h.currency, 1).currency : ((by === 'sector' ? h.sector : h.country) ?? '')
    groups.set(key, (groups.get(key) ?? 0) + h.value)
  }
  const total = [...groups.values()].reduce((s, v) => s + v, 0)
  const sorted = [...groups].sort((a, b) => b[1] - a[1])
  const kept = sorted.length > maxGroups ? sorted.slice(0, maxGroups - 1) : sorted
  const slices: AllocationSlice[] = kept.map(([key, value]) => ({ key, kind: key === '' ? 'unknown' : 'group', value, share: value / total }))
  const rest = sorted.slice(kept.length).reduce((s, [, v]) => s + v, 0)
  if (rest > 0) slices.push({ key: '', kind: 'other', value: rest, share: rest / total })
  return slices
}
