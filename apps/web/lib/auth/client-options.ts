import { getEnv } from '../env.ts'
import { authCookieOptions } from './cookie.ts'
import { INTERNAL_HEADER, internalProxyToken } from './internal-proxy.ts'

/** Options shared by every server-side auth client: the session cookie and, when self-hosted, the proxy token. */
export function authClientOptions() {
  const env = getEnv()
  const headers: Record<string, string> =
    env.AUTH_PROXY_TARGET && env.AUTH_JWT_SECRET ? { [INTERNAL_HEADER]: internalProxyToken(env.AUTH_JWT_SECRET) } : {}
  return { cookieOptions: authCookieOptions(env.PUBLIC_URL), global: { headers } }
}
