import { describe, expect, it } from 'vitest'
import { parseDecimalInput } from '../src/decimal.ts'

describe('parseDecimalInput', () => {
  it('reads German numbers', () => {
    expect(parseDecimalInput('12,5', 'de')).toBe(12.5)
    expect(parseDecimalInput('1.000', 'de')).toBe(1000)
    expect(parseDecimalInput('1.234,56', 'de')).toBe(1234.56)
    expect(parseDecimalInput('0,2367', 'de')).toBe(0.2367)
    expect(parseDecimalInput('12.5', 'de')).toBe(12.5)
  })
  it('reads English numbers', () => {
    expect(parseDecimalInput('12.5', 'en')).toBe(12.5)
    expect(parseDecimalInput('1,000', 'en')).toBe(1000)
    expect(parseDecimalInput('1,234.56', 'en')).toBe(1234.56)
    expect(parseDecimalInput('12,5', 'en')).toBe(12.5)
  })
  it('ignores spaces and rejects anything that is not a number', () => {
    expect(parseDecimalInput(' 39 900 ', 'de')).toBe(39900)
    expect(parseDecimalInput('', 'de')).toBeNull()
    expect(parseDecimalInput('abc', 'en')).toBeNull()
    expect(parseDecimalInput('1,2,3', 'de')).toBeNull()
    expect(parseDecimalInput('-5', 'en')).toBe(-5)
  })
  it('never reads a leading zero as a thousands group (penny-stock prices)', () => {
    expect(parseDecimalInput('0.385', 'de')).toBe(0.385)
    expect(parseDecimalInput('0,385', 'en')).toBe(0.385)
    expect(parseDecimalInput('-0.385', 'de')).toBe(-0.385)
    expect(parseDecimalInput('01.000', 'de')).toBe(1)
  })
  it('refuses both separators in the wrong order or a misplaced group', () => {
    expect(parseDecimalInput('1.234,56', 'en')).toBeNull()
    expect(parseDecimalInput('1,234.56', 'de')).toBeNull()
    expect(parseDecimalInput('1.23,4', 'de')).toBeNull()
    expect(parseDecimalInput('1.234,5,6', 'de')).toBeNull()
    expect(parseDecimalInput('12.345.678,9', 'de')).toBe(12345678.9)
  })
})
