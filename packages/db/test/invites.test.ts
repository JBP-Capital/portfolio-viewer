import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { NotFoundError } from '../src/errors.ts'
import { claimInvite, createInvite, listMembers, removeMember, revokeInvite, setMemberRole, setMemberStatus } from '../src/invites.ts'
import { getMember } from '../src/members.ts'
import { invites } from '../src/schema.ts'
import { makeMember, useTestDb } from './helpers.ts'

const { db } = useTestDb()
const account = (email: string) => ({ id: randomUUID(), email })

async function admin() {
  return makeMember(db, 'admin@example.com', { role: 'admin', userId: randomUUID() })
}

describe('invites', () => {
  it('creates a link that works once and makes the account an active member', async () => {
    const a = await admin()
    const { token, memberId } = await createInvite(db, a.id, ' Friend@Example.com ')
    expect(await getMember(db, memberId)).toMatchObject({ email: 'friend@example.com', status: 'invited', role: 'member', userId: null })
    const user = account('friend@example.com')
    const claimed = await claimInvite(db, token, user)
    expect(claimed).toMatchObject({ kind: 'ok', member: { id: memberId, userId: user.id, status: 'active' } })
    expect(await claimInvite(db, token, account('someone@example.com'))).toEqual({ kind: 'invalid' })
  })

  it('stores only a hash of the token', async () => {
    const a = await admin()
    const { token } = await createInvite(db, a.id, 'friend@example.com')
    const [row] = await db.select().from(invites)
    expect(row!.tokenHash).not.toContain(token)
    expect(JSON.stringify(row)).not.toContain(token)
  })

  it('takes the address of the account that claims the link when it differs', async () => {
    const a = await admin()
    const { token, memberId } = await createInvite(db, a.id, 'old@example.com')
    await claimInvite(db, token, account('New@Example.com'))
    expect((await getMember(db, memberId)).email).toBe('new@example.com')
  })

  it('refuses expired, revoked, unknown and malformed tokens', async () => {
    const a = await admin()
    const expired = await createInvite(db, a.id, 'late@example.com', new Date(Date.now() - 8 * 24 * 3600_000))
    expect(await claimInvite(db, expired.token, account('late@example.com'))).toEqual({ kind: 'invalid' })
    const revoked = await createInvite(db, a.id, 'gone@example.com')
    await revokeInvite(db, a.id, revoked.memberId)
    expect(await claimInvite(db, revoked.token, account('gone@example.com'))).toEqual({ kind: 'invalid' })
    expect(await claimInvite(db, 'x'.repeat(43), account('x@example.com'))).toEqual({ kind: 'invalid' })
    expect(await claimInvite(db, '', account('x@example.com'))).toEqual({ kind: 'invalid' })
  })

  it('lets exactly one of two parallel claims win', async () => {
    const a = await admin()
    const { token } = await createInvite(db, a.id, 'friend@example.com')
    const results = await Promise.all([claimInvite(db, token, account('one@example.com')), claimInvite(db, token, account('two@example.com'))])
    expect(results.map((r) => r.kind).sort()).toEqual(['invalid', 'ok'])
  })

  it('does not invite an address that already belongs to an active member; a new link replaces the old one', async () => {
    const a = await admin()
    await expect(createInvite(db, a.id, 'admin@example.com')).rejects.toMatchObject({ issues: [{ path: 'email', message: 'exists' }] })
    await expect(createInvite(db, a.id, 'not an address')).rejects.toMatchObject({ issues: [{ path: 'email' }] })
    const first = await createInvite(db, a.id, 'friend@example.com')
    const second = await createInvite(db, a.id, 'friend@example.com')
    expect(second.memberId).toBe(first.memberId)
    expect(await claimInvite(db, first.token, account('friend@example.com'))).toEqual({ kind: 'invalid' })
    expect((await claimInvite(db, second.token, account('friend@example.com'))).kind).toBe('ok')
  })

  it('does not link an account that already has access', async () => {
    const a = await admin()
    const { token } = await createInvite(db, a.id, 'friend@example.com')
    expect(await claimInvite(db, token, { id: a.userId!, email: 'admin@example.com' })).toEqual({ kind: 'already_member' })
  })
})

describe('member management', () => {
  it('lists members and changes status and role, never one’s own', async () => {
    const a = await admin()
    const m = await makeMember(db, 'member@example.com')
    expect((await listMembers(db, a.id)).map((x) => x.email)).toEqual(['admin@example.com', 'member@example.com'])
    await setMemberStatus(db, a.id, m.id, 'disabled')
    expect((await getMember(db, m.id)).status).toBe('disabled')
    await setMemberRole(db, a.id, m.id, 'admin')
    expect((await getMember(db, m.id)).role).toBe('admin')
    await expect(setMemberStatus(db, a.id, a.id, 'disabled')).rejects.toMatchObject({ issues: [{ path: 'memberId', message: 'self' }] })
    await expect(removeMember(db, a.id, a.id)).rejects.toMatchObject({ issues: [{ path: 'memberId', message: 'self' }] })
    expect(await removeMember(db, a.id, m.id)).toEqual({ userId: null })
    await expect(getMember(db, m.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses all of it to members who are not administrators', async () => {
    await admin()
    const m = await makeMember(db, 'member@example.com')
    const other = await makeMember(db, 'other@example.com')
    await expect(createInvite(db, m.id, 'friend@example.com')).rejects.toBeInstanceOf(NotFoundError)
    await expect(listMembers(db, m.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(setMemberStatus(db, m.id, other.id, 'disabled')).rejects.toBeInstanceOf(NotFoundError)
    await expect(removeMember(db, m.id, other.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(setMemberRole(db, m.id, m.id, 'admin')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('administrators at the same time', () => {
  it('never lets two administrators remove each other’s access at once', async () => {
    for (let i = 0; i < 5; i += 1) {
      const a = await makeMember(db, `a${i}@example.com`, { role: 'admin', userId: randomUUID() })
      const b = await makeMember(db, `b${i}@example.com`, { role: 'admin', userId: randomUUID() })
      await Promise.allSettled([setMemberRole(db, a.id, b.id, 'member'), setMemberStatus(db, b.id, a.id, 'disabled')])
      const [ra, rb] = [await getMember(db, a.id), await getMember(db, b.id)]
      const activeAdmins = [ra, rb].filter((m) => m.role === 'admin' && m.status === 'active')
      expect(activeAdmins.length).toBeGreaterThanOrEqual(1)
    }
  })
})

