import { describe, expect, it } from 'vitest'
import { safeNextPath } from '../lib/safe-next.ts'

describe('safeNextPath', () => {
  it('keeps local paths', () => {
    expect(safeNextPath('/reset-password')).toBe('/reset-password')
    expect(safeNextPath('/p/123?tab=transactions')).toBe('/p/123?tab=transactions')
  })
  it('refuses other sites and odd values', () => {
    for (const value of ['https://evil.com', '//evil.com', '/\\evil.com', 'evil.com', '', null, undefined]) {
      expect(safeNextPath(value)).toBe('/')
    }
  })
  it('refuses paths that URL parsing turns into another site by dropping tabs and line breaks', () => {
    for (const value of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\t\\evil.com', '/\r\\evil.com']) {
      expect(new URL(safeNextPath(value), 'https://portfolio.example.com').origin).toBe('https://portfolio.example.com')
    }
  })
  it('refuses paths whose dot segments collapse into another site', () => {
    for (const value of ['/.//evil.com', '/a/..//evil.com', '/%2e//evil.com', '/./\\evil.com']) {
      expect(safeNextPath(value)).toBe('/')
    }
  })
})
