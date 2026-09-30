import { SignJWT } from 'jose'
import { getEnv } from '../env.ts'

export async function mintAnonKey(secret: string): Promise<string> {
  return new SignJWT({ role: 'anon' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('portfolio-viewer')
    .setIssuedAt()
    .setExpirationTime('10y')
    .sign(new TextEncoder().encode(secret))
}

let cached: Promise<string> | undefined

/** The public API key the auth client sends; minted from the self-host secret when not configured. */
export function getAnonKey(): Promise<string> {
  const env = getEnv()
  if (env.AUTH_ANON_KEY) return Promise.resolve(env.AUTH_ANON_KEY)
  if (!env.AUTH_JWT_SECRET) throw new Error('Set AUTH_ANON_KEY or AUTH_JWT_SECRET')
  cached ??= mintAnonKey(env.AUTH_JWT_SECRET)
  return cached
}
