import { describe, expect, it } from 'vitest'
import { AUTH_COOKIE, authCookieOptions } from '../lib/auth/cookie.ts'

describe('authCookieOptions', () => {
  it('keeps the session cookie away from page scripts', () => {
    expect(authCookieOptions('http://localhost:3000')).toMatchObject({ name: AUTH_COOKIE, httpOnly: true, sameSite: 'lax', path: '/' })
  })
  it('sends the session cookie only over HTTPS when the app is served over HTTPS', () => {
    expect(authCookieOptions('https://portfolio.jbpcapital.de').secure).toBe(true)
    expect(authCookieOptions('http://localhost:3000').secure).toBe(false)
  })
})
