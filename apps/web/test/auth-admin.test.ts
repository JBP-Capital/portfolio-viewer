import { describe, expect, it } from 'vitest'
import { ownsAuthServer } from '../lib/auth/owns-auth.ts'

describe('ownsAuthServer', () => {
  it('is true for the self-hosted login service behind this app', () => {
    expect(ownsAuthServer({ AUTH_PROXY_TARGET: 'http://auth:9999' })).toBe(true)
  })
  it('is false for a shared login service (hosted: the jbpcapital.de accounts), whose logins must survive', () => {
    expect(ownsAuthServer({ AUTH_PROXY_TARGET: undefined })).toBe(false)
  })
})
