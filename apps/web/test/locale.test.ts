import { describe, expect, it } from 'vitest'
import { pickLocale } from '../lib/locale.ts'

describe('pickLocale', () => {
  it('prefers a valid cookie', () => {
    expect(pickLocale('de', 'en-US,en;q=0.9')).toBe('de')
  })
  it('falls back to the first supported browser language', () => {
    expect(pickLocale(undefined, 'de-DE,de;q=0.9,en;q=0.8')).toBe('de')
    expect(pickLocale('xx', 'fr-FR,en;q=0.5')).toBe('en')
  })
  it('defaults to English', () => {
    expect(pickLocale(undefined, '')).toBe('en')
    expect(pickLocale(undefined, 'fr-FR')).toBe('en')
  })
})
