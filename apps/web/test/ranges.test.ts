import { describe, expect, it } from 'vitest'
import { hypotheticalStart, parseRange, rangeStart } from '../lib/ranges.ts'

describe('chart ranges', () => {
  it('reads the range from the address, defaulting to one year', () => {
    expect(parseRange('5Y')).toBe('5Y')
    expect(parseRange(undefined)).toBe('1Y')
    expect(parseRange('7Y')).toBe('1Y')
    expect(parseRange(['MAX', '1M'])).toBe('MAX')
  })

  it('starts a range at its calendar date, but never before the first trade', () => {
    expect(rangeStart('1M', '2026-09-28', '2020-01-01')).toBe('2026-08-28')
    expect(rangeStart('6M', '2026-09-28', '2020-01-01')).toBe('2026-03-28')
    expect(rangeStart('YTD', '2026-09-28', '2020-01-01')).toBe('2025-12-31')
    expect(rangeStart('5Y', '2026-09-28', '2024-05-02')).toBe('2024-05-02')
    expect(rangeStart('MAX', '2026-09-28', '2024-05-02')).toBe('2024-05-02')
    expect(rangeStart('MAX', '2026-09-28', null)).toBe('2026-09-28')
  })

  it('starts the hypothetical chart at the calendar date, ten years back for the longest range', () => {
    expect(hypotheticalStart('1M', '2026-09-28')).toBe('2026-08-28')
    expect(hypotheticalStart('YTD', '2026-09-28')).toBe('2025-12-31')
    expect(hypotheticalStart('5Y', '2026-09-28')).toBe('2021-09-28')
    expect(hypotheticalStart('MAX', '2026-09-28')).toBe('2016-09-28')
  })
})
