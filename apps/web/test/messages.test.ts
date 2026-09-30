import { describe, expect, it } from 'vitest'
import de from '../messages/de.json' with { type: 'json' }
import en from '../messages/en.json' with { type: 'json' }

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
}

describe('translations', () => {
  it('has every English key in German and no extra German keys', () => {
    expect(keys(de).sort()).toEqual(keys(en).sort())
  })
  it('has no empty strings', () => {
    for (const [name, messages] of Object.entries({ en, de })) {
      const empty = keys(messages).filter((k) => k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], messages) === '')
      expect(empty, name).toEqual([])
    }
  })
})
