import { describe, expect, it } from 'vitest'
import { Backoff } from '../src/backoff.ts'

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 28, 12, 0) + minutes * 60_000)

describe('Backoff', () => {
  it('waits five minutes after the first failure and doubles the wait up to a day', () => {
    const backoff = new Backoff()
    expect(backoff.ready('A', at(0))).toBe(true)
    backoff.failed('A', at(0))
    expect(backoff.ready('A', at(4))).toBe(false)
    expect(backoff.ready('A', at(5))).toBe(true)
    backoff.failed('A', at(5))
    expect(backoff.ready('A', at(5 + 9))).toBe(false)
    expect(backoff.ready('A', at(5 + 10))).toBe(true)
    for (let i = 0; i < 20; i += 1) backoff.failed('A', at(0))
    expect(backoff.ready('A', at(24 * 60 - 1))).toBe(false)
    expect(backoff.ready('A', at(24 * 60))).toBe(true)
  })

  it('forgets a key after a success and keeps keys apart', () => {
    const backoff = new Backoff()
    backoff.failed('A', at(0))
    expect(backoff.ready('B', at(0))).toBe(true)
    backoff.succeeded('A')
    expect(backoff.ready('A', at(0))).toBe(true)
  })
})
