// Postgres "cannot connect now" (still starting) and connection exceptions, plus network errors of a
// database container that is not reachable yet after a host restart.
const STARTING_CODES = new Set(['57P03', '08000', '08001', '08003', '08006', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'])

/** True for errors that only mean "the database is not up yet" (also when wrapped as the cause). */
export function isDatabaseStarting(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && typeof e === 'object' && depth < 5; e = (e as { cause?: unknown }).cause, depth += 1) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && STARTING_CODES.has(code)) return true
  }
  return false
}

/**
 * Runs `task`, trying again while the database is still starting: 1 s, 2 s, 4 s, then every 5 s, for
 * at most `limitMs` (2 minutes). Any other error, and the last one after the limit, is thrown.
 */
export async function retryWhileDatabaseStarts<T>(
  task: () => Promise<T>,
  options: { limitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const limitMs = options.limitMs ?? 120_000
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let waited = 0
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      const wait = Math.min(5000, 1000 * 2 ** attempt)
      if (!isDatabaseStarting(error) || waited + wait > limitMs) throw error
      waited += wait
      await sleep(wait)
    }
  }
}
