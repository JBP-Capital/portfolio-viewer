import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  claimPairing,
  deviceByToken,
  listDevices,
  normalizePairingCode,
  pollPairing,
  revokeDevice,
  startPairing,
} from '../src/devices.ts'
import { NotFoundError, ThrottledError, ValidationError } from '../src/errors.ts'
import { members, pairingCodes, tvDevices } from '../src/schema.ts'
import { makeMember, useTestDb } from './helpers.ts'

const { db } = useTestDb()
const NOW = new Date('2026-09-28T18:00:00Z')
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

async function paired(email = 'a@example.com') {
  const member = await makeMember(db, email)
  const { code, pollSecret } = await startPairing(db, NOW)
  const device = await claimPairing(db, member.id, code, 'Living room', later(1))
  const poll = await pollPairing(db, pollSecret, later(1))
  if (poll.status !== 'paired') throw new Error('not paired')
  return { member, device, token: poll.token }
}

describe('pairing codes', () => {
  it('uses six unambiguous characters and accepts them typed loosely', async () => {
    const { code } = await startPairing(db, NOW)
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    expect(normalizePairingCode(` ${code.slice(0, 3).toLowerCase()}-${code.slice(3)} `)).toBe(code)
    expect(normalizePairingCode('ABC-DE0')).toBeNull()
    expect(normalizePairingCode('ABCDE')).toBeNull()
  })

  it('waits for the member, then hands the token out exactly once', async () => {
    const member = await makeMember(db, 'a@example.com')
    const { code, pollSecret, expiresAt } = await startPairing(db, NOW)
    expect(expiresAt).toEqual(later(10))
    expect(await pollPairing(db, pollSecret, later(1))).toEqual({ status: 'waiting', code, expiresAt })
    const device = await claimPairing(db, member.id, code, '  Living room  ', later(2))
    expect(device).toMatchObject({ name: 'Living room' })
    const poll = await pollPairing(db, pollSecret, later(2))
    expect(poll.status).toBe('paired')
    const token = poll.status === 'paired' ? poll.token : ''
    expect(token.length).toBeGreaterThanOrEqual(43)
    expect(await pollPairing(db, pollSecret, later(2))).toEqual({ status: 'expired' })
    expect(await deviceByToken(db, token, later(3))).toEqual({ deviceId: device.id, memberId: member.id })
  })

  it('stores only hashes of the token and the poll secret', async () => {
    const member = await makeMember(db, 'a@example.com')
    const { code, pollSecret } = await startPairing(db, NOW)
    const [pending] = await db.select().from(pairingCodes).where(eq(pairingCodes.code, code))
    expect(pending!.pollSecretHash).not.toContain(pollSecret)
    await claimPairing(db, member.id, code, 'TV', later(1))
    const poll = await pollPairing(db, pollSecret, later(1))
    const token = poll.status === 'paired' ? poll.token : 'missing'
    const [device] = await db.select().from(tvDevices)
    expect(device!.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(device!.tokenHash).not.toBe(token)
  })

  it('gives nothing to a browser without the poll secret', async () => {
    const member = await makeMember(db, 'a@example.com')
    const { code } = await startPairing(db, NOW)
    await claimPairing(db, member.id, code, 'TV', later(1))
    expect(await pollPairing(db, 'guessed-secret', later(1))).toEqual({ status: 'expired' })
  })

  it('refuses expired, claimed and unknown codes', async () => {
    const member = await makeMember(db, 'a@example.com')
    const first = await startPairing(db, NOW)
    await expect(claimPairing(db, member.id, first.code, 'TV', later(11))).rejects.toBeInstanceOf(NotFoundError)
    const second = await startPairing(db, NOW)
    await claimPairing(db, member.id, second.code, 'TV', later(1))
    await expect(claimPairing(db, member.id, second.code, 'TV', later(1))).rejects.toBeInstanceOf(NotFoundError)
    await expect(claimPairing(db, member.id, 'nope', 'TV', later(1))).rejects.toBeInstanceOf(NotFoundError)
    await expect(claimPairing(db, member.id, second.code, '', later(1))).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses new codes while too many are waiting, so the open pairing route cannot fill the table', async () => {
    await db.insert(pairingCodes).values(
      Array.from({ length: 1000 }, (_, i) => ({ code: `W${String(i).padStart(5, '0')}`, pollSecretHash: `hash-${i}`, expiresAt: later(5) })),
    )
    await expect(startPairing(db, NOW)).rejects.toBeInstanceOf(ThrottledError)
    expect((await startPairing(db, later(6))).code).toHaveLength(6)
  })

  it('stops guessing after 10 wrong codes in 15 minutes, even for a valid code', async () => {
    const member = await makeMember(db, 'a@example.com')
    const { code } = await startPairing(db, NOW)
    for (let i = 0; i < 10; i += 1) await expect(claimPairing(db, member.id, 'ZZZZZZ', 'TV', later(1))).rejects.toBeInstanceOf(NotFoundError)
    await expect(claimPairing(db, member.id, code, 'TV', later(1))).rejects.toBeInstanceOf(ThrottledError)
  })
})

describe('guessing limit under load', () => {
  it('records at most 10 wrong codes even when 20 arrive at the same time', async () => {
    const member = await makeMember(db, 'a@example.com')
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => claimPairing(db, member.id, 'ZZZZZZ', 'TV', later(1))))
    const wrong = results.filter((r) => r.status === 'rejected' && r.reason instanceof NotFoundError).length
    const throttled = results.filter((r) => r.status === 'rejected' && r.reason instanceof ThrottledError).length
    expect(wrong).toBeLessThanOrEqual(10)
    expect(wrong + throttled).toBe(20)
  })
})

describe('devices', () => {
  it('lists and revokes only the member’s own devices', async () => {
    const a = await paired('a@example.com')
    const b = await makeMember(db, 'b@example.com')
    expect((await listDevices(db, a.member.id)).map((d) => d.name)).toEqual(['Living room'])
    expect(await listDevices(db, b.id)).toEqual([])
    await expect(revokeDevice(db, b.id, a.device.id)).rejects.toBeInstanceOf(NotFoundError)
    expect(await deviceByToken(db, a.token, later(2))).not.toBeNull()
    await revokeDevice(db, a.member.id, a.device.id)
    expect(await deviceByToken(db, a.token, later(2))).toBeNull()
  })

  it('shows nothing for a disabled or deleted member', async () => {
    const a = await paired('a@example.com')
    await db.update(members).set({ status: 'disabled' }).where(eq(members.id, a.member.id))
    expect(await deviceByToken(db, a.token, later(2))).toBeNull()
    await db.delete(members).where(eq(members.id, a.member.id))
    expect(await db.select().from(tvDevices)).toEqual([])
  })

  it('records when a device was last seen, at most every 10 minutes', async () => {
    const a = await paired('a@example.com')
    await deviceByToken(db, a.token, later(2))
    await deviceByToken(db, a.token, later(5))
    expect((await listDevices(db, a.member.id))[0]!.lastSeenAt).toEqual(later(2))
    await deviceByToken(db, a.token, later(13))
    expect((await listDevices(db, a.member.id))[0]!.lastSeenAt).toEqual(later(13))
  })
})
