import { describe, expect, it } from 'vitest'
import { hasInternalToken, internalProxyToken, isPublicAuthRequest } from '../lib/auth/internal-proxy.ts'

const secret = 's'.repeat(40)

describe('auth proxy access', () => {
  it('lets browsers reach only the e-mail link endpoint', () => {
    expect(isPublicAuthRequest('GET', ['verify'])).toBe(true)
    expect(isPublicAuthRequest('POST', ['token'])).toBe(false)
    expect(isPublicAuthRequest('POST', ['signup'])).toBe(false)
    expect(isPublicAuthRequest('GET', ['user'])).toBe(false)
    expect(isPublicAuthRequest('POST', ['verify'])).toBe(false)
    expect(isPublicAuthRequest('GET', ['verify', 'extra'])).toBe(false)
  })

  it('accepts the server’s own token and nothing else', () => {
    const token = internalProxyToken(secret)
    expect(hasInternalToken(token, secret)).toBe(true)
    expect(hasInternalToken(internalProxyToken('t'.repeat(40)), secret)).toBe(false)
    expect(hasInternalToken(null, secret)).toBe(false)
    expect(hasInternalToken('', secret)).toBe(false)
  })
})
