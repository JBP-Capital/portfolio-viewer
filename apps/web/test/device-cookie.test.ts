import { describe, expect, it } from 'vitest'
import { DEVICE_COOKIE, deviceCookieOptions, PAIRING_COOKIE, pairingCookieOptions } from '../lib/auth/device-cookie.ts'

describe('TV cookies', () => {
  it('keeps the device token away from page scripts and remembers the TV for over a year', () => {
    const options = deviceCookieOptions('http://localhost:3310')
    expect(DEVICE_COOKIE).toBe('pv-tv')
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: false })
    expect(options.maxAge).toBeGreaterThanOrEqual(365 * 24 * 60 * 60)
  })

  it('sends both cookies only over HTTPS when the app is served over HTTPS', () => {
    expect(deviceCookieOptions('https://portfolio.jbpcapital.de').secure).toBe(true)
    expect(pairingCookieOptions('https://portfolio.jbpcapital.de').secure).toBe(true)
  })

  it('keeps the pairing secret only as long as a code can be claimed', () => {
    const options = pairingCookieOptions('http://localhost:3310')
    expect(PAIRING_COOKIE).toBe('pv-pair')
    expect(options).toMatchObject({ httpOnly: true, path: '/api/tv' })
    expect(options.maxAge).toBeLessThanOrEqual(15 * 60)
  })
})
