import { describe, expect, it } from 'vitest'
import { resolveSearchResult } from '../lib/instrument-resolve.ts'

const known = { instrumentId: 'i1', listingId: 'l1', mic: 'XNYS', symbol: 'AEM', name: 'Agnico Eagle Mines', exchangeName: 'XNYS', type: 'stock', currency: 'USD', sector: null }
const remote = { ...known, instrumentId: null, listingId: null, currency: null }
const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status })

describe('resolveSearchResult', () => {
  it('uses a known security without asking the server', async () => {
    const fetcher = async () => {
      throw new Error('must not be called')
    }
    expect(await resolveSearchResult(known, fetcher)).toEqual({ instrumentId: 'i1', listingId: 'l1', name: 'Agnico Eagle Mines', symbol: 'AEM', mic: 'XNYS', currency: 'USD' })
  })

  it('adds a security found at the provider', async () => {
    const added = { instrumentId: 'i2', listingId: 'l2', name: 'Agnico Eagle Mines', symbol: 'AEM', mic: 'XNYS', currency: 'USD' }
    expect(await resolveSearchResult(remote, json(200, added))).toEqual(added)
  })

  it('returns null when the server refuses or cannot be reached', async () => {
    expect(await resolveSearchResult(remote, json(404, { error: 'not_found' }))).toBeNull()
    expect(
      await resolveSearchResult(remote, async () => {
        throw new TypeError('Failed to fetch')
      }),
    ).toBeNull()
  })
})
