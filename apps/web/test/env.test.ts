import { describe, expect, it } from 'vitest'
import { parseEnv } from '../lib/env.ts'

const base = { DATABASE_URL: 'postgres://x', PUBLIC_URL: 'http://localhost:3000', AUTH_URL: 'http://127.0.0.1:3000' }

describe('SOURCE_URL', () => {
  it('points at this repository unless the operator runs a modified copy', () => {
    expect(parseEnv(base).SOURCE_URL).toBe('https://github.com/JBP-Capital/portfolio-viewer')
    expect(parseEnv({ ...base, SOURCE_URL: 'https://git.example.com/me/portfolio-viewer' }).SOURCE_URL).toBe('https://git.example.com/me/portfolio-viewer')
  })

  it('never renders anything but an http(s) address, and a mistake there does not stop the app', () => {
    const fallback = 'https://github.com/JBP-Capital/portfolio-viewer'
    for (const value of ['javascript:alert(1)', 'not a url', 'git@github.com:me/portfolio-viewer.git', '']) {
      expect(parseEnv({ ...base, SOURCE_URL: value }).SOURCE_URL).toBe(fallback)
    }
  })
})
