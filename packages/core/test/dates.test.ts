import { describe, expect, it } from 'vitest'
import { addDays, addMonths, eachDay, endOfPreviousMonth, todayInTimeZone } from '../src/dates.ts'

describe('dates', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('adds months and clamps to the last day of the month', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29')
    expect(addMonths('2026-01-15', -12)).toBe('2025-01-15')
  })
  it('finds the end of the previous month', () => {
    expect(endOfPreviousMonth('2026-03-15')).toBe('2026-02-28')
    expect(endOfPreviousMonth('2026-01-01')).toBe('2025-12-31')
  })
  it('lists every day of a range inclusive', () => {
    expect(eachDay('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
  })
  it('gives today in the member time zone', () => {
    const now = new Date('2026-01-31T23:30:00Z')
    expect(todayInTimeZone('Europe/Berlin', now)).toBe('2026-02-01')
    expect(todayInTimeZone('America/New_York', now)).toBe('2026-01-31')
  })
})
