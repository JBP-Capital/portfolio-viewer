import { describe, expect, it } from 'vitest'
import { EXCHANGES, hasSessionEnded, isExchangeOpen } from '../src/exchanges.ts'

describe('hasSessionEnded', () => {
  it('is false while the exchange trades and true after its close', () => {
    expect(hasSessionEnded('XNYS', new Date('2026-09-28T15:00:00Z'))).toBe(false) // 11:00 New York
    expect(hasSessionEnded('XNYS', new Date('2026-09-28T20:05:00Z'))).toBe(true) // 16:05
    expect(hasSessionEnded('XASX', new Date('2026-09-28T00:30:00Z'))).toBe(false) // 10:30 Sydney
    expect(hasSessionEnded('XASX', new Date('2026-09-28T07:00:00Z'))).toBe(true) // 17:00 Sydney
  })
  it('counts the weekend as ended and unknown exchanges as still running', () => {
    expect(hasSessionEnded('XNYS', new Date('2026-09-26T15:00:00Z'))).toBe(true)
    expect(hasSessionEnded('XXXX', new Date('2026-09-28T20:05:00Z'))).toBe(false)
  })
})

describe('isExchangeOpen', () => {
  it('knows New York trading hours with a grace period after the close', () => {
    expect(isExchangeOpen('XNYS', new Date('2026-09-28T15:00:00Z'))).toBe(true) // Monday 11:00 New York
    expect(isExchangeOpen('XNYS', new Date('2026-09-28T13:00:00Z'))).toBe(false) // 09:00, before the open
    expect(isExchangeOpen('XNYS', new Date('2026-09-28T20:15:00Z'))).toBe(true) // 16:15, inside the grace
    expect(isExchangeOpen('XNYS', new Date('2026-09-28T21:00:00Z'))).toBe(false) // 17:00
  })
  it('is closed on weekends', () => {
    expect(isExchangeOpen('XNYS', new Date('2026-09-26T15:00:00Z'))).toBe(false) // Saturday
    expect(isExchangeOpen('XETR', new Date('2026-09-27T10:00:00Z'))).toBe(false) // Sunday
  })
  it('uses the exchange time zone', () => {
    expect(isExchangeOpen('XFRA', new Date('2026-09-28T19:30:00Z'))).toBe(true) // 21:30 Frankfurt
    expect(isExchangeOpen('XASX', new Date('2026-09-28T01:00:00Z'))).toBe(true) // 11:00 Sydney
    expect(isExchangeOpen('XASX', new Date('2026-09-28T12:00:00Z'))).toBe(false) // 22:00 Sydney
  })
  it('treats unknown exchanges as open so they are never silently skipped', () => {
    expect(isExchangeOpen('XXXX', new Date('2026-09-26T15:00:00Z'))).toBe(true)
  })
  it('describes the exchanges held in the reference portfolio', () => {
    for (const mic of ['XNYS', 'XNAS', 'OTCM', 'XTSE', 'XTSX', 'XLON', 'XETR', 'XFRA', 'XASX']) expect(EXCHANGES[mic]).toBeDefined()
  })
})
