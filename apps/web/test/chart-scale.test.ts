import { describe, expect, it } from 'vitest'
import { evenIndices, markerPoint, nearestIndex, niceTicks } from '../lib/chart-scale.ts'

describe('niceTicks', () => {
  it('covers the range with clean steps', () => {
    expect(niceTicks(0, 1234)).toEqual([0, 500, 1000, 1500])
    expect(niceTicks(-12, 37)).toEqual([-20, 0, 20, 40])
    expect(niceTicks(0.1, 0.34)).toEqual([0.1, 0.2, 0.3, 0.4])
  })

  it('still spreads ticks when every value is the same', () => {
    const ticks = niceTicks(100, 100)
    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks[0]).toBeLessThan(100)
    expect(ticks.at(-1)).toBeGreaterThan(100)
    expect(niceTicks(0, 0)).toEqual([-1, -0.5, 0, 0.5, 1])
  })
})

describe('nearestIndex', () => {
  it('finds the closest position in a sorted list', () => {
    expect(nearestIndex([0, 10, 20], 4)).toBe(0)
    expect(nearestIndex([0, 10, 20], 6)).toBe(1)
    expect(nearestIndex([0, 10, 20], 25)).toBe(2)
    expect(nearestIndex([0, 10, 20], -5)).toBe(0)
    expect(nearestIndex([], 3)).toBe(-1)
  })
})

describe('evenIndices', () => {
  it('spreads label positions from the first to the last point', () => {
    expect(evenIndices(10, 4)).toEqual([0, 3, 6, 9])
    expect(evenIndices(3, 5)).toEqual([0, 1, 2])
    expect(evenIndices(1, 5)).toEqual([0])
    expect(evenIndices(0, 5)).toEqual([])
  })
})

describe('markerPoint', () => {
  const points = [
    { date: '2026-01-02', value: 1 },
    { date: '2026-01-09', value: 2 },
    { date: '2026-01-16', value: 3 },
  ]
  it('puts a trade on the drawn point whose period contains it', () => {
    expect(markerPoint(points, '2026-01-05')).toEqual(points[1])
    expect(markerPoint(points, '2026-01-09')).toEqual(points[1])
    expect(markerPoint(points, '2026-01-01')).toEqual(points[0])
  })
  it('keeps a trade after the last price on the last point', () => {
    expect(markerPoint(points, '2026-02-01')).toEqual(points[2])
    expect(markerPoint([], '2026-02-01')).toBeNull()
  })
})
