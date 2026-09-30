import { createClient } from '@supabase/supabase-js'
import { SignJWT } from 'jose'
import { getEnv } from '../env.ts'
import { authClientOptions } from './client-options.ts'
import { ownsAuthServer } from './owns-auth.ts'

/** The auth server's service key: configured (hosted) or minted from the self-host secret. */
async function serviceKey(): Promise<string> {
  const env = getEnv()
  if (env.AUTH_SERVICE_ROLE_KEY) return env.AUTH_SERVICE_ROLE_KEY
  if (!env.AUTH_JWT_SECRET) throw new Error('Set AUTH_SERVICE_ROLE_KEY or AUTH_JWT_SECRET')
  return new SignJWT({ role: 'service_role' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('portfolio-viewer')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(env.AUTH_JWT_SECRET))
}

/** Removes a login account from the auth server (after its member row was deleted). */
export async function deleteAuthUser(userId: string): Promise<void> {
  const client = createClient(getEnv().AUTH_URL, await serviceKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: authClientOptions().global,
  })
  const { error } = await client.auth.admin.deleteUser(userId)
  if (error && error.status !== 404) throw error
}

/**
 * Removes the login of a deleted member when this instance owns the login service. The member's data
 * is already gone at this point, so a failure is logged instead of breaking the sign-out.
 */
export async function removeLogin(userId: string | null): Promise<void> {
  if (!userId || !ownsAuthServer(getEnv())) return
  try {
    await deleteAuthUser(userId)
  } catch (error) {
    console.error('[auth] could not delete the login of a deleted member', error)
  }
}
