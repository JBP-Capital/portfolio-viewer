import { createHash, randomBytes } from 'node:crypto'
import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db, Executor } from './client.ts'
import { assertId, NotFoundError, parseInput, ValidationError } from './errors.ts'
import { ADMIN_LOCK_KEY, type Member } from './members.ts'
import { invites, members } from './schema.ts'

const VALID_DAYS = 7

export type ClaimResult = { kind: 'ok'; member: Member } | { kind: 'invalid' } | { kind: 'already_member' }

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/**
 * Only active administrators may manage members; anyone else is told there is nothing here. Runs
 * under the admin lock, so two administrators cannot remove each other's access at the same moment.
 */
async function assertAdmin(db: Executor, adminId: string): Promise<void> {
  assertId(adminId, 'Member')
  await db.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK_KEY})`)
  const [row] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, adminId), eq(members.role, 'admin'), eq(members.status, 'active')))
  if (!row) throw new NotFoundError('Member')
}

function assertOther(adminId: string, memberId: string): void {
  assertId(memberId, 'Member')
  if (adminId === memberId) throw new ValidationError('Administrators cannot change their own access here', [{ path: 'memberId', message: 'self' }])
}

/**
 * Invites an address: creates (or reuses) its member row with status "invited" and returns a new
 * one-time link token, which replaces any earlier link for that address. The token is shown once and
 * stored only as a hash.
 */
export async function createInvite(db: Db, adminId: string, rawEmail: string, now: Date = new Date()): Promise<{ token: string; memberId: string }> {
  const email = parseInput(z.object({ email: z.email() }), { email: rawEmail.trim().toLowerCase() }).email
  return db.transaction(async (t) => {
    await assertAdmin(t, adminId)
    const [existing] = await t.select().from(members).where(eq(members.email, email))
    if (existing && (existing.userId !== null || existing.status !== 'invited')) {
      throw new ValidationError('This address already has access', [{ path: 'email', message: 'exists' }])
    }
    const memberId = existing?.id ?? (await t.insert(members).values({ email, status: 'invited', role: 'member' }).returning({ id: members.id }))[0]!.id
    await t.delete(invites).where(eq(invites.memberId, memberId))
    const token = randomBytes(32).toString('base64url')
    await t.insert(invites).values({ tokenHash: hashToken(token), memberId, createdBy: adminId, createdAt: now, expiresAt: new Date(now.getTime() + VALID_DAYS * 24 * 3600_000) })
    return { token, memberId }
  })
}

/**
 * Links the signed-in account to the invited member row, once. The link itself proves the invite
 * (self-hosted instances confirm no addresses); the account's address replaces the invited one.
 */
export async function claimInvite(db: Db, token: string, user: { id: string; email: string }): Promise<ClaimResult> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { kind: 'invalid' }
  const email = user.email.trim().toLowerCase()
  return db.transaction(async (t) => {
    const [row] = await t
      .select({ invite: invites, member: members })
      .from(invites)
      .innerJoin(members, eq(members.id, invites.memberId))
      .where(and(eq(invites.tokenHash, hashToken(token)), isNull(invites.usedAt), gt(invites.expiresAt, new Date()), isNull(members.userId)))
      .for('update')
    if (!row) return { kind: 'invalid' }
    const [linked] = await t.select({ id: members.id }).from(members).where(eq(members.userId, user.id))
    if (linked) return { kind: 'already_member' }
    const [taken] = await t.select({ id: members.id }).from(members).where(and(eq(members.email, email), ne(members.id, row.member.id)))
    const [member] = await t
      .update(members)
      .set({ userId: user.id, status: 'active', email: taken ? row.member.email : email, lastLoginAt: new Date() })
      .where(eq(members.id, row.member.id))
      .returning()
    await t.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, row.invite.id))
    return { kind: 'ok', member: member! }
  })
}

export interface MemberListEntry {
  id: string
  email: string
  displayName: string | null
  role: 'admin' | 'member'
  status: 'invited' | 'active' | 'disabled'
  lastLoginAt: Date | null
  inviteExpiresAt: Date | null
}

export async function listMembers(db: Db, adminId: string): Promise<MemberListEntry[]> {
  await assertAdmin(db, adminId)
  return db
    .select({
      id: members.id,
      email: members.email,
      displayName: members.displayName,
      role: members.role,
      status: members.status,
      lastLoginAt: members.lastLoginAt,
      inviteExpiresAt: invites.expiresAt,
    })
    .from(members)
    .leftJoin(invites, and(eq(invites.memberId, members.id), isNull(invites.usedAt)))
    .orderBy(asc(members.createdAt), asc(members.email))
}

async function updateOther(db: Db, adminId: string, memberId: string, values: Partial<typeof members.$inferInsert>): Promise<void> {
  await db.transaction(async (t) => {
    await assertAdmin(t, adminId)
    assertOther(adminId, memberId)
    const rows = await t.update(members).set(values).where(eq(members.id, memberId)).returning({ id: members.id })
    if (rows.length === 0) throw new NotFoundError('Member')
  })
}

export async function setMemberStatus(db: Db, adminId: string, memberId: string, status: 'active' | 'disabled'): Promise<void> {
  await updateOther(db, adminId, memberId, { status })
}

export async function setMemberRole(db: Db, adminId: string, memberId: string, role: 'admin' | 'member'): Promise<void> {
  await updateOther(db, adminId, memberId, { role })
}

/** Deletes another member with all their data; returns the login account id for the auth server. */
export async function removeMember(db: Db, adminId: string, memberId: string): Promise<{ userId: string | null }> {
  return db.transaction(async (t) => {
    await assertAdmin(t, adminId)
    assertOther(adminId, memberId)
    const [removed] = await t.delete(members).where(eq(members.id, memberId)).returning({ userId: members.userId })
    if (!removed) throw new NotFoundError('Member')
    return { userId: removed.userId }
  })
}

/** Withdraws a pending invite (the member row goes with it). */
export async function revokeInvite(db: Db, adminId: string, memberId: string): Promise<void> {
  await db.transaction(async (t) => {
    await assertAdmin(t, adminId)
    assertOther(adminId, memberId)
    await t.delete(members).where(and(eq(members.id, memberId), eq(members.status, 'invited'), isNull(members.userId)))
  })
}
