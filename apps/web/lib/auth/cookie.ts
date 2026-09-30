import type { CookieOptionsWithName } from '@supabase/ssr'

export const AUTH_COOKIE = 'pv-auth'

/**
 * The session cookie holds the refresh token. Only the server reads it (there is no browser auth
 * client), so page scripts never get to see it, and it travels only over HTTPS when the app does.
 */
export function authCookieOptions(publicUrl: string): CookieOptionsWithName {
  return { name: AUTH_COOKIE, path: '/', httpOnly: true, sameSite: 'lax', secure: publicUrl.startsWith('https://') }
}
