import { describe, expect, it } from 'vitest'
import { getJson, getText } from '../src/http.ts'
import type { FetchLike } from '../src/types.ts'

/** Fails with a network error (no HTTP response) the first `failures` times, then answers. */
function flakyFetch(failures: number): FetchLike & { attempts: () => number } {
  let attempts = 0
  const fn: FetchLike = async () => {
    attempts += 1
    if (attempts <= failures) throw new TypeError('fetch failed')
    return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => 'ok' }
  }
  return Object.assign(fn, { attempts: () => attempts })
}

describe('HTTP helpers', () => {
  it('retry once after a network error before any response', async () => {
    const fetch = flakyFetch(1)
    expect(await getJson('https://example.test/a', fetch)).toEqual({ ok: true })
    expect(fetch.attempts()).toBe(2)
    expect(await getText('https://example.test/b', flakyFetch(1))).toBe('ok')
  })

  it('give up after the retry', async () => {
    await expect(getJson('https://example.test/a', flakyFetch(2))).rejects.toThrow('fetch failed')
  })
})
