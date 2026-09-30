/** The TV's read-only device token. */
export const DEVICE_COOKIE = 'pv-tv'
/** The poll secret of a TV that waits to be paired. */
export const PAIRING_COOKIE = 'pv-pair'

const DEVICE_MAX_AGE = 400 * 24 * 60 * 60
// A code lives 10 minutes plus 2 after it was claimed.
const PAIRING_MAX_AGE = 12 * 60

export interface CookieOptions {
  path: string
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  maxAge: number
}

export function deviceCookieOptions(publicUrl: string): CookieOptions {
  return { path: '/', httpOnly: true, sameSite: 'lax', secure: publicUrl.startsWith('https://'), maxAge: DEVICE_MAX_AGE }
}

/** Sent only to the pairing route, which is the only reader. */
export function pairingCookieOptions(publicUrl: string): CookieOptions {
  return { path: '/api/tv', httpOnly: true, sameSite: 'lax', secure: publicUrl.startsWith('https://'), maxAge: PAIRING_MAX_AGE }
}
