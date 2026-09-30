import { describe, expect, it } from 'vitest'
import { formatMoney, formatPercent, formatPrice, formatQuantity } from '../lib/format.ts'

// Intl separates German amounts from the unit with a no-break space.
const nbsp = (s: string) => s.replace(/ /g, ' ')

describe('formatting', () => {
  it('formats money per language', () => {
    expect(formatMoney(1234.5, 'EUR', 'de')).toBe(nbsp('1.234,50 €'))
    expect(formatMoney(1234.5, 'EUR', 'en')).toBe('€1,234.50')
    expect(formatMoney(12.3, 'EUR', 'en', { signed: true })).toBe('+€12.30')
  })
  it('shows small prices with four decimals and quantities without trailing zeros', () => {
    expect(formatPrice(0.2367, 'EUR', 'de')).toBe(nbsp('0,2367 €'))
    expect(formatPrice(101.5, 'USD', 'en')).toBe('$101.50')
    expect(formatQuantity(39900, 'de')).toBe('39.900')
    expect(formatQuantity(0.125, 'en')).toBe('0.125')
  })
  it('formats fractions as percent', () => {
    expect(formatPercent(0.0512, 'de', { signed: true })).toBe(nbsp('+5,12 %'))
    expect(formatPercent(-0.1, 'en', { signed: true })).toBe('-10.00%')
  })
})
