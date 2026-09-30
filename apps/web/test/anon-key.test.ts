import { jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'
import { mintAnonKey } from '../lib/auth/anon-key.ts'

describe('mintAnonKey', () => {
  it('signs an anon role token with the auth secret', async () => {
    const secret = 'x'.repeat(40)
    const token = await mintAnonKey(secret)
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
    expect(payload.role).toBe('anon')
  })
})
