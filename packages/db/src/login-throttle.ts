import { and, count, eq, gte, lt } from 'drizzle-orm'
import type { Db, Executor } from './client.ts'
import { loginAttempts } from './schema.ts'

const MAX_FAILED_ATTEMPTS = 10
const WINDOW_MS = 15 * 60_000
const KEEP_MS = 24 * 60 * 60_000

const normalize = (email: string) => email.trim().toLowerCase()

/** True when the address had too many failed password logins in the last 15 minutes. */
export async function isLoginThrottled(db: Executor, email: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS)
  const [row] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, normalize(email)), gte(loginAttempts.attemptedAt, since)))
  return (row?.n ?? 0) >= MAX_FAILED_ATTEMPTS
}

export async function recordFailedLogin(db: Executor, email: string): Promise<void> {
  await db.insert(loginAttempts).values({ email: normalize(email) })
  await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, new Date(Date.now() - KEEP_MS)))
}

export async function clearFailedLogins(db: Db, email: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.email, normalize(email)))
}
