import { describe, expect, it } from 'vitest'
import { clearFailedLogins, isLoginThrottled, recordFailedLogin } from '../src/login-throttle.ts'
import { loginAttempts } from '../src/schema.ts'
import { useTestDb } from './helpers.ts'

const { db } = useTestDb()

describe('login throttle', () => {
  it('blocks an address after 10 failed attempts within 15 minutes', async () => {
    for (let i = 0; i < 9; i += 1) await recordFailedLogin(db, 'anna@example.com')
    expect(await isLoginThrottled(db, 'anna@example.com')).toBe(false)
    await recordFailedLogin(db, 'Anna@Example.com')
    expect(await isLoginThrottled(db, 'ANNA@example.com')).toBe(true)
    expect(await isLoginThrottled(db, 'other@example.com')).toBe(false)
  })

  it('forgets attempts older than 15 minutes', async () => {
    const old = new Date(Date.now() - 16 * 60_000)
    await db.insert(loginAttempts).values(Array.from({ length: 10 }, () => ({ email: 'anna@example.com', attemptedAt: old })))
    expect(await isLoginThrottled(db, 'anna@example.com')).toBe(false)
  })

  it('starts over after a successful login', async () => {
    for (let i = 0; i < 10; i += 1) await recordFailedLogin(db, 'anna@example.com')
    await clearFailedLogins(db, 'anna@example.com')
    expect(await isLoginThrottled(db, 'anna@example.com')).toBe(false)
  })
})
