/**
 * Reloads the TV's data only when the server answers. A refresh against a server that is down makes
 * Next.js fall back to a full page load, which would leave the TV on the browser's error page.
 */
export async function refreshWhenReachable(probe: () => Promise<boolean>, refresh: () => void): Promise<boolean> {
  const reachable = await probe().catch(() => false)
  if (reachable) refresh()
  return reachable
}

/** The health check the TV asks before refreshing. */
export async function serverReachable(): Promise<boolean> {
  const response = await fetch('/api/health', { cache: 'no-store' })
  return response.ok
}

/** Waiting time before the next reconnect attempt: 30 s, doubling, at most 5 minutes. */
export function reconnectDelay(attempt: number): number {
  return Math.min(300_000, 30_000 * 2 ** attempt)
}
