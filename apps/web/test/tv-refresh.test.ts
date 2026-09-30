import { describe, expect, it, vi } from 'vitest'
import { reconnectDelay, refreshWhenReachable } from '../lib/tv-refresh.ts'

describe('TV refresh', () => {
  it('reloads the data only when the server answers, so a restart never leaves the TV on an error page', async () => {
    const refresh = vi.fn()
    expect(await refreshWhenReachable(async () => false, refresh)).toBe(false)
    expect(await refreshWhenReachable(async () => Promise.reject(new Error('offline')), refresh)).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
    expect(await refreshWhenReachable(async () => true, refresh)).toBe(true)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('tries to reconnect after 30 s, then less and less often, at least every 5 minutes', () => {
    expect([0, 1, 2, 3, 4, 10].map(reconnectDelay)).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000])
  })
})
