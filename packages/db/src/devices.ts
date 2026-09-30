import { createHash, randomBytes, randomInt } from 'node:crypto'
import { and, count, desc, eq, gt, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './client.ts'
import { assertId, NotFoundError, parseInput, ThrottledError } from './errors.ts'
import { isLoginThrottled, recordFailedLogin } from './login-throttle.ts'
import { members, pairingCodes, tvDevices } from './schema.ts'

/** No 0/O or 1/I: codes are read off a TV and typed on a phone. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const PAIRING_MINUTES = 10
/** After a member claims a code, the TV has this long to fetch its token. */
const CLAIMED_MINUTES = 2
const SEEN_EVERY_MS = 10 * 60_000
/** Codes are handed out without sign-in; this caps how many can wait at once. */
const MAX_WAITING_CODES = 1000

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const newSecret = () => randomBytes(32).toString('base64url')
const minutesAfter = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000)
// Failed claims share the login throttle, keyed per member.
const throttleKey = (memberId: string) => `pairing:${memberId}`

const deviceNameSchema = z.string().trim().min(1).max(40)

export interface TvDevice {
  id: string
  name: string
  createdAt: Date
  lastSeenAt: Date | null
}

/** The code as stored ('abc-def' → 'ABCDEF'), or null when it cannot be a pairing code. */
export function normalizePairingCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '')
  return code.length === 6 && [...code].every((c) => ALPHABET.includes(c)) ? code : null
}

/** A new code for a TV that waits to be paired; the poll secret stays with that TV. */
export async function startPairing(db: Db, now: Date = new Date()): Promise<{ code: string; pollSecret: string; expiresAt: Date }> {
  // Codes nobody claimed, and devices whose TV never fetched its token, are dropped.
  await db.delete(pairingCodes).where(lte(pairingCodes.expiresAt, now))
  await db.delete(tvDevices).where(and(isNull(tvDevices.tokenHash), lt(tvDevices.createdAt, minutesAfter(now, -PAIRING_MINUTES))))
  const [waiting] = await db.select({ n: count() }).from(pairingCodes)
  if ((waiting?.n ?? 0) >= MAX_WAITING_CODES) throw new ThrottledError()
  const pollSecret = newSecret()
  const expiresAt = minutesAfter(now, PAIRING_MINUTES)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
    const [row] = await db
      .insert(pairingCodes)
      .values({ code, pollSecretHash: sha256(pollSecret), expiresAt })
      .onConflictDoNothing()
      .returning({ code: pairingCodes.code })
    if (row) return { code, pollSecret, expiresAt }
  }
  throw new Error('No free pairing code found')
}

export type PairingPoll = { status: 'waiting'; code: string; expiresAt: Date } | { status: 'paired'; token: string } | { status: 'expired' }

/** What the waiting TV sees; once claimed, the token is created, handed out once and only its hash kept. */
export async function pollPairing(db: Db, pollSecret: string, now: Date = new Date()): Promise<PairingPoll> {
  const [row] = await db.select().from(pairingCodes).where(eq(pairingCodes.pollSecretHash, sha256(pollSecret)))
  if (!row || row.expiresAt <= now) return { status: 'expired' }
  const deviceId = row.deviceId
  if (deviceId === null) return { status: 'waiting', code: row.code, expiresAt: row.expiresAt }
  const token = newSecret()
  return db.transaction(async (t) => {
    const taken = await t
      .delete(pairingCodes)
      .where(and(eq(pairingCodes.code, row.code), eq(pairingCodes.pollSecretHash, row.pollSecretHash)))
      .returning({ code: pairingCodes.code })
    if (taken.length === 0) return { status: 'expired' } as const
    await t.update(tvDevices).set({ tokenHash: sha256(token) }).where(eq(tvDevices.id, deviceId))
    return { status: 'paired', token } as const
  })
}

/** Links the TV showing `rawCode` to the member under the given name. */
export async function claimPairing(db: Db, memberId: string, rawCode: string, rawName: unknown, now: Date = new Date()): Promise<TvDevice> {
  const name = parseInput(deviceNameSchema, rawName)
  const code = normalizePairingCode(rawCode)
  const key = throttleKey(memberId)
  const device = await db.transaction(async (t) => {
    // One claim per member at a time, so parallel guesses cannot all pass the limit before any is counted.
    await t.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`)
    if (await isLoginThrottled(t, key)) return 'throttled' as const
    const [row] =
      code === null
        ? []
        : await t
            .select()
            .from(pairingCodes)
            .where(and(eq(pairingCodes.code, code), gt(pairingCodes.expiresAt, now), isNull(pairingCodes.deviceId)))
            .for('update')
    if (!row) {
      await recordFailedLogin(t, key)
      return 'not_found' as const
    }
    const [created] = await t.insert(tvDevices).values({ memberId, name }).returning()
    await t.update(pairingCodes).set({ deviceId: created!.id, expiresAt: minutesAfter(now, CLAIMED_MINUTES) }).where(eq(pairingCodes.code, row.code))
    return created!
  })
  if (device === 'throttled') throw new ThrottledError()
  if (device === 'not_found') throw new NotFoundError('Pairing code')
  return { id: device.id, name: device.name, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt }
}

/** The member a device token belongs to, if the device is still paired and the member active. */
export async function deviceByToken(db: Db, token: string, now: Date = new Date()): Promise<{ deviceId: string; memberId: string } | null> {
  const [row] = await db
    .select({ id: tvDevices.id, memberId: tvDevices.memberId, lastSeenAt: tvDevices.lastSeenAt })
    .from(tvDevices)
    .innerJoin(members, eq(members.id, tvDevices.memberId))
    .where(and(eq(tvDevices.tokenHash, sha256(token)), eq(members.status, 'active')))
  if (!row) return null
  if (row.lastSeenAt === null || now.getTime() - row.lastSeenAt.getTime() >= SEEN_EVERY_MS) {
    await db.update(tvDevices).set({ lastSeenAt: now }).where(eq(tvDevices.id, row.id))
  }
  return { deviceId: row.id, memberId: row.memberId }
}

export async function listDevices(db: Db, memberId: string): Promise<TvDevice[]> {
  return db
    .select({ id: tvDevices.id, name: tvDevices.name, createdAt: tvDevices.createdAt, lastSeenAt: tvDevices.lastSeenAt })
    .from(tvDevices)
    .where(and(eq(tvDevices.memberId, memberId), isNotNull(tvDevices.tokenHash)))
    .orderBy(desc(tvDevices.createdAt))
}

export async function revokeDevice(db: Db, memberId: string, deviceId: string): Promise<void> {
  assertId(deviceId, 'Device')
  const removed = await db
    .delete(tvDevices)
    .where(and(eq(tvDevices.id, deviceId), eq(tvDevices.memberId, memberId)))
    .returning({ id: tvDevices.id })
  if (removed.length === 0) throw new NotFoundError('Device')
}
