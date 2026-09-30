const MINOR_UNITS: Record<string, { major: string; factor: number }> = {
  GBX: { major: 'GBP', factor: 0.01 },
  GBp: { major: 'GBP', factor: 0.01 },
  ZAC: { major: 'ZAR', factor: 0.01 },
  ZAc: { major: 'ZAR', factor: 0.01 },
  ILA: { major: 'ILS', factor: 0.01 },
}

const PROVIDER_SPELLINGS: Record<string, string> = { GBp: 'GBX', ZAc: 'ZAC' }

/** Provider currency codes as stored: three upper-case letters, minor units keep their own code. */
export function normalizeCurrencyCode(code: string): string {
  return PROVIDER_SPELLINGS[code] ?? code.toUpperCase()
}

/** Converts an amount quoted in a minor unit (e.g. London pence) to its major currency. */
export function toMajorUnit(currency: string, amount: number): { currency: string; amount: number } {
  const minor = MINOR_UNITS[currency]
  return minor ? { currency: minor.major, amount: amount * minor.factor } : { currency, amount }
}

/**
 * Members type exchange rates per major unit ("EUR per GBP"); transactions store them per unit of the
 * listing currency (per penny for GBX), because prices are in that unit.
 */
export function ratePerListingUnit(ratePerMajor: number, currency: string): number {
  return toMajorUnit(currency, ratePerMajor).amount
}

/** The stored rate of a transaction, shown per major unit again (the inverse of ratePerListingUnit). */
export function ratePerMajorUnit(ratePerListing: number, currency: string): number {
  return ratePerListing / toMajorUnit(currency, 1).amount
}

/** Base currencies a member can choose: the euro and the currencies of the ECB reference rates. */
export const BASE_CURRENCIES = [
  'EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'ISK', 'TRY',
  'BRL', 'CNY', 'HKD', 'IDR', 'ILS', 'INR', 'KRW', 'MXN', 'MYR', 'NZD', 'PHP', 'SGD', 'THB', 'ZAR',
] as const
