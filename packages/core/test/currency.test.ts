import { describe, expect, it } from 'vitest'
import { normalizeCurrencyCode, ratePerListingUnit, ratePerMajorUnit, toMajorUnit } from '../src/currency.ts'

describe('normalizeCurrencyCode', () => {
  it('maps provider spellings of minor units to three upper-case letters', () => {
    expect(normalizeCurrencyCode('GBp')).toBe('GBX')
    expect(normalizeCurrencyCode('ZAc')).toBe('ZAC')
    expect(normalizeCurrencyCode('usd')).toBe('USD')
    expect(normalizeCurrencyCode('ILA')).toBe('ILA')
  })
})

describe('toMajorUnit', () => {
  it('converts London pence to pounds', () => {
    expect(toMajorUnit('GBX', 250)).toEqual({ currency: 'GBP', amount: 2.5 })
    expect(toMajorUnit('GBp', 250)).toEqual({ currency: 'GBP', amount: 2.5 })
  })
  it('converts South African cents and Israeli agorot', () => {
    expect(toMajorUnit('ZAC', 1000)).toEqual({ currency: 'ZAR', amount: 10 })
    expect(toMajorUnit('ILA', 100)).toEqual({ currency: 'ILS', amount: 1 })
  })
  it('leaves major currencies unchanged', () => {
    expect(toMajorUnit('EUR', 12.5)).toEqual({ currency: 'EUR', amount: 12.5 })
  })
})

describe('exchange rates typed per major unit', () => {
  it('stores a rate per pound as a rate per penny and shows it back per pound', () => {
    expect(ratePerListingUnit(1.16, 'GBX')).toBeCloseTo(0.0116, 12)
    expect(ratePerMajorUnit(0.0116, 'GBX')).toBeCloseTo(1.16, 12)
  })
  it('leaves ordinary currencies alone', () => {
    expect(ratePerListingUnit(0.9, 'USD')).toBe(0.9)
    expect(ratePerMajorUnit(0.9, 'USD')).toBe(0.9)
  })
})
