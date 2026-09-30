import type { FetchLike } from './types.ts'

export class ProviderError extends Error {
  /** HTTP status of the failed response, if there was one. */
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}

// Ten years of daily history is a few hundred kilobytes; allow slow connections.
export const defaultFetch: FetchLike = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(45_000) })

const RETRY_PAUSE_MS = 1_000
const pause = () => new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS))

/**
 * One GET with a single retry after a short pause when the network failed before any response
 * (reset, DNS hiccup) or the server answered 429 / 5xx.
 */
async function getOk(url: string, fetchImpl: FetchLike, headers: Record<string, string>) {
  for (let attempt = 0; ; attempt += 1) {
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await fetchImpl(url, { headers })
    } catch (error) {
      if (attempt >= 1) throw error
      await pause()
      continue
    }
    if (response.ok) return response
    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt >= 1) throw new ProviderError(`GET ${url} failed with HTTP ${response.status}`, response.status)
    await pause()
  }
}

export async function getJson(url: string, fetchImpl: FetchLike = defaultFetch, headers: Record<string, string> = {}): Promise<unknown> {
  return (await getOk(url, fetchImpl, headers)).json()
}

export async function getText(url: string, fetchImpl: FetchLike = defaultFetch): Promise<string> {
  return (await getOk(url, fetchImpl, {})).text()
}
