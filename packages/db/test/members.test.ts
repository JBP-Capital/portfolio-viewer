import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { NotFoundError } from '../src/errors.ts'
import { upsertListing } from '../src/instruments.ts'
import { saveFxRates } from '../src/market.ts'
import { deleteMember, getMember, hasTransactions, resolveAccess, updateMemberSettings } from '../src/members.ts'
import { createPortfolio } from '../src/portfolios.ts'
import { listings, transactions } from '../src/schema.ts'
import { createTransaction } from '../src/transactions.ts'
import { makeMember, useTestDb } from './helpers.ts'

const { db } = useTestDb()
const user = (email: string) => ({ id: randomUUID(), email })

describe('resolveAccess', () => {
  it('makes the first account of an empty instance an active admin', async () => {
    const result = await resolveAccess(db, user('Owner@Example.com'))
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.member).toMatchObject({ role: 'admin', status: 'active', email: 'owner@example.com' })
  })

  it('refuses a second account that was not invited', async () => {
    await resolveAccess(db, user('owner@example.com'))
    expect((await resolveAccess(db, user('stranger@example.com'))).kind).toBe('no_access')
  })

  it('links an invited address on first login regardless of capitalisation when addresses are verified', async () => {
    await makeMember(db, 'owner@example.com', { role: 'admin' })
    await makeMember(db, 'anna@example.com', { status: 'invited' })
    const anna = user('Anna@Example.com')
    const result = await resolveAccess(db, anna, { linkInvitesByEmail: true })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.member).toMatchObject({ userId: anna.id, status: 'active', role: 'member' })
    const again = await resolveAccess(db, anna)
    expect(again.kind === 'ok' && again.member.id).toBe(result.kind === 'ok' && result.member.id)
  })

  it('does not let an unverified account claim an invite by its address', async () => {
    await makeMember(db, 'owner@example.com', { role: 'admin' })
    await makeMember(db, 'anna@example.com', { status: 'invited' })
    expect((await resolveAccess(db, user('anna@example.com'))).kind).toBe('no_access')
  })

  it('lets parallel first requests of the first account all through', async () => {
    const owner = user('owner@example.com')
    const results = await Promise.all([resolveAccess(db, owner), resolveAccess(db, owner), resolveAccess(db, owner)])
    expect(results.map((r) => r.kind)).toEqual(['ok', 'ok', 'ok'])
  })

  it('lets parallel first requests of an invited account all through', async () => {
    await makeMember(db, 'owner@example.com', { role: 'admin' })
    await makeMember(db, 'anna@example.com', { status: 'invited' })
    const anna = user('anna@example.com')
    const results = await Promise.all([
      resolveAccess(db, anna, { linkInvitesByEmail: true }),
      resolveAccess(db, anna, { linkInvitesByEmail: true }),
      resolveAccess(db, anna, { linkInvitesByEmail: true }),
    ])
    expect(results.map((r) => r.kind)).toEqual(['ok', 'ok', 'ok'])
  })

  it('does not hand an already linked member to another account with the same address', async () => {
    await makeMember(db, 'anna@example.com', { userId: randomUUID() })
    expect((await resolveAccess(db, user('anna@example.com'), { linkInvitesByEmail: true })).kind).toBe('no_access')
  })

  it('reports disabled members', async () => {
    const anna = user('anna@example.com')
    await makeMember(db, 'anna@example.com', { userId: anna.id, status: 'disabled' })
    expect((await resolveAccess(db, anna)).kind).toBe('disabled')
  })

  it('creates exactly one admin when two accounts sign up at the same time', async () => {
    const results = await Promise.all([resolveAccess(db, user('a@example.com')), resolveAccess(db, user('b@example.com'))])
    expect(results.filter((r) => r.kind === 'ok')).toHaveLength(1)
    expect(results.filter((r) => r.kind === 'no_access')).toHaveLength(1)
  })
})

describe('member settings', () => {
  it('saves name, language, time zone and base currency', async () => {
    const member = await makeMember(db, 'owner@example.com')
    const saved = await updateMemberSettings(db, member.id, { displayName: '  Jim  ', locale: 'de', timezone: 'America/Toronto', baseCurrency: 'USD' })
    expect(saved).toMatchObject({ displayName: 'Jim', locale: 'de', timezone: 'America/Toronto', baseCurrency: 'USD' })
    expect((await updateMemberSettings(db, member.id, { displayName: '' })).displayName).toBeNull()
  })

  it('refuses unknown languages, time zones and currencies', async () => {
    const member = await makeMember(db, 'owner@example.com')
    await expect(updateMemberSettings(db, member.id, { locale: 'fr' })).rejects.toMatchObject({ issues: [{ path: 'locale' }] })
    await expect(updateMemberSettings(db, member.id, { timezone: 'Mars/Olympus' })).rejects.toMatchObject({ issues: [{ path: 'timezone' }] })
    await expect(updateMemberSettings(db, member.id, { baseCurrency: 'XYZ' })).rejects.toMatchObject({ issues: [{ path: 'baseCurrency' }] })
  })

  it('refuses to change the base currency once transactions exist', async () => {
    const member = await makeMember(db, 'owner@example.com')
    const portfolio = await createPortfolio(db, member.id, { name: 'Main' })
    const { instrumentId } = await upsertListing(db, { name: 'SAP SE', mic: 'XETR', symbol: 'SAP', currency: 'EUR' })
    await createTransaction(db, member.id, { portfolioId: portfolio.id, instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: 'EUR', quantity: 1, price: 100 })
    expect(await hasTransactions(db, member.id)).toBe(true)
    await expect(updateMemberSettings(db, member.id, { baseCurrency: 'USD' })).rejects.toMatchObject({ issues: [{ path: 'baseCurrency', message: 'has_transactions' }] })
    expect((await updateMemberSettings(db, member.id, { baseCurrency: 'EUR', locale: 'de' })).locale).toBe('de')
  })
})

describe('deleteMember', () => {
  it('removes the member with portfolios and transactions but keeps shared market data', async () => {
    await makeMember(db, 'admin@example.com', { role: 'admin' })
    const member = await makeMember(db, 'owner@example.com')
    const portfolio = await createPortfolio(db, member.id, { name: 'Main' })
    const { instrumentId, listingId } = await upsertListing(db, { name: 'SAP SE', mic: 'XETR', symbol: 'SAP', currency: 'EUR' })
    await createTransaction(db, member.id, { portfolioId: portfolio.id, instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: 'EUR', quantity: 1, price: 100 })
    const { userId } = await deleteMember(db, member.id)
    expect(userId).toBe(member.userId)
    await expect(getMember(db, member.id)).rejects.toBeInstanceOf(NotFoundError)
    expect(await db.select().from(transactions)).toHaveLength(0)
    expect(await db.select().from(listings).where(eq(listings.id, listingId))).toHaveLength(1)
  })

  it('refuses to delete the last active admin', async () => {
    const admin = await makeMember(db, 'admin@example.com', { role: 'admin' })
    await expect(deleteMember(db, admin.id)).rejects.toMatchObject({ issues: [{ path: 'role', message: 'last_admin' }] })
    await makeMember(db, 'second@example.com', { role: 'admin' })
    await deleteMember(db, admin.id)
  })
})

describe('base currency and writes at the same time', () => {
  it('never stores a rate for the old base currency when the base changes meanwhile', async () => {
    await saveFxRates(db, [{ currency: 'USD', date: '2026-01-05', perEur: 1.25 }])
    const { instrumentId } = await upsertListing(db, { name: 'SAP SE', mic: 'XETR', symbol: 'SAP', currency: 'EUR' })
    for (let i = 0; i < 10; i += 1) {
      const member = await makeMember(db, `race${i}@example.com`)
      const portfolio = await createPortfolio(db, member.id, { name: 'Main' })
      await Promise.allSettled([
        updateMemberSettings(db, member.id, { baseCurrency: 'USD' }),
        createTransaction(db, member.id, { portfolioId: portfolio.id, instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: 'EUR', quantity: 1, price: 100 }),
      ])
      const base = (await getMember(db, member.id)).baseCurrency
      const [tx] = await db.select().from(transactions).where(eq(transactions.portfolioId, portfolio.id))
      expect(tx!.fxRate).toBeCloseTo(base === 'USD' ? 1.25 : 1, 9)
    }
  })
})
