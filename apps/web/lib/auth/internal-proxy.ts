import { createHmac, timingSafeEqual } from 'node:crypto'

/** Header that marks auth requests coming from this app's own server code. */
export const INTERNAL_HEADER = 'x-pv-internal'

/** Derived from the auth secret, so every server process computes the same value without sharing state. */
export function internalProxyToken(secret: string): string {
  return createHmac('sha256', secret).update('portfolio-viewer internal auth proxy').digest('hex')
}

export function hasInternalToken(value: string | null, secret: string): boolean {
  if (!value) return false
  const expected = Buffer.from(internalProxyToken(secret))
  const given = Buffer.from(value)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * Browsers only need GoTrue for the links in its e-mails (`GET /verify`). Everything else — sign-in,
 * sign-up, password reset — goes through the app's server actions, which throttle and check access.
 */
export function isPublicAuthRequest(method: string, path: readonly string[]): boolean {
  return method === 'GET' && path.length === 1 && path[0] === 'verify'
}
