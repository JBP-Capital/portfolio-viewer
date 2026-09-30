import { BASE_CURRENCIES } from '@pv/core'
import { and, count, eq, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db, Executor } from './client.ts'
import { NotFoundError, parseInput, ValidationError } from './errors.ts'
import { members, portfolios, transactions } from './schema.ts'

export type Member = typeof members.$inferSelect
export type AccessResult = { kind: 'ok'; member: Member } | { kind: 'no_access' } | { kind: 'disabled' }

/** Serialises changes to who is an administrator (first sign-up, deletions, role and status changes). */
export const ADMIN_LOCK_KEY = 7_423_001

export async function countMembers(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(members)
  return row?.n ?? 0
}

export async function getMember(db: Db, memberId: string): Promise<Member> {
  const [member] = await db.select().from(members).where(eq(members.id, memberId))
  if (!member) throw new NotFoundError('Member')
  return member
}

/** The first account on an empty instance becomes admin; serialized so two sign-ups cannot both win. */
async function bootstrapFirstAdmin(db: Db, userId: string, email: string): Promise<Member | null> {
  return db.transaction(async (t) => {
    await t.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK_KEY})`)
    const [existing] = await t.select({ id: members.id }).from(members).limit(1)
    if (existing) return null
    const [admin] = await t
      .insert(members)
      .values({ userId, email, role: 'admin', status: 'active', lastLoginAt: new Date() })
      .returning()
    return admin ?? null
  })
}

export interface AccessOptions {
  /**
   * Link an invite to the account whose e-mail matches it. Only safe when the auth server proves
   * mailbox ownership before issuing a session (e-mail confirmation on); with auto-confirmed
   * sign-ups anyone could claim an invite by typing the invited address.
   */
  linkInvitesByEmail?: boolean
}

/**
 * Decides whether an authenticated account may use this instance.
 * Access needs a member row: found by account id, or (see AccessOptions) an invited address not yet
 * linked to an account.
 */
export async function resolveAccess(db: Db, user: { id: string; email: string }, options: AccessOptions = {}): Promise<AccessResult> {
  const email = user.email.trim().toLowerCase()
  const byAccount = async () => (await db.select().from(members).where(eq(members.userId, user.id)))[0]
  let member = await byAccount()

  if (!member && options.linkInvitesByEmail) {
    const [invited] = await db.select().from(members).where(eq(members.email, email))
    if (invited && invited.userId === null) {
      ;[member] = await db
        .update(members)
        .set({ userId: user.id, status: invited.status === 'invited' ? 'active' : invited.status })
        .where(and(eq(members.id, invited.id), isNull(members.userId)))
        .returning()
      // A parallel request of the same account may have linked it a moment earlier.
      member ??= await byAccount()
    }
  }

  if (!member) {
    // A parallel request of the same account may have become the first admin a moment earlier.
    member = (await bootstrapFirstAdmin(db, user.id, email)) ?? (await byAccount())
    if (!member) return { kind: 'no_access' }
  }

  if (member.status === 'disabled') return { kind: 'disabled' }

  await db
    .update(members)
    .set({ lastLoginAt: new Date() })
    .where(and(eq(members.id, member.id), sql`(${members.lastLoginAt} is null or ${members.lastLoginAt} < now() - interval '1 hour')`))
  return { kind: 'ok', member }
}

const settingsSchema = z.object({
  displayName: z
    .string()
    .trim()
    .max(80)
    .transform((v) => v || null)
    .optional(),
  locale: z.enum(['en', 'de']).optional(),
  baseCurrency: z.enum(BASE_CURRENCIES).optional(),
  timezone: z
    .string()
    .refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz) || tz === 'UTC', 'unknown time zone')
    .optional(),
})

export async function hasTransactions(db: Executor, memberId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(transactions)
    .innerJoin(portfolios, eq(portfolios.id, transactions.portfolioId))
    .where(eq(portfolios.memberId, memberId))
  return (row?.n ?? 0) > 0
}

/**
 * Changes the member's own settings. The base currency is fixed once transactions exist: their stored
 * exchange rates convert into it, so a change would silently mix currencies.
 */
export async function updateMemberSettings(db: Db, memberId: string, raw: unknown): Promise<Member> {
  const input = parseInput(settingsSchema, raw)
  return db.transaction(async (t) => {
    const [current] = await t.select().from(members).where(eq(members.id, memberId)).for('update')
    if (!current) throw new NotFoundError('Member')
    if (input.baseCurrency && input.baseCurrency !== current.baseCurrency && (await hasTransactions(t, memberId))) {
      throw new ValidationError('The base currency cannot change once transactions exist', [{ path: 'baseCurrency', message: 'has_transactions' }])
    }
    const [updated] = await t.update(members).set(input).where(eq(members.id, memberId)).returning()
    return updated!
  })
}

/**
 * Deletes a member with all their portfolios and transactions (shared market data stays). Returns the
 * login account id, which the caller removes from the auth server. The last active admin cannot go.
 */
export async function deleteMember(db: Db, memberId: string): Promise<{ userId: string | null }> {
  return db.transaction(async (t) => {
    await t.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK_KEY})`)
    const [member] = await t.select().from(members).where(eq(members.id, memberId))
    if (!member) throw new NotFoundError('Member')
    if (member.role === 'admin' && member.status === 'active') {
      const [others] = await t
        .select({ n: count() })
        .from(members)
        .where(and(eq(members.role, 'admin'), eq(members.status, 'active'), ne(members.id, memberId)))
      if ((others?.n ?? 0) === 0) throw new ValidationError('The last administrator cannot be deleted', [{ path: 'role', message: 'last_admin' }])
    }
    await t.delete(members).where(eq(members.id, memberId))
    return { userId: member.userId }
  })
}

/** The language a login account chose in its settings, to restore it on another device after sign-in. */
export async function memberLocale(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ locale: members.locale }).from(members).where(eq(members.userId, userId))
  return row?.locale ?? null
}
