const tag = (locale: string) => (locale === 'de' ? 'de-DE' : 'en-US')

export function formatMoney(value: number, currency: string, locale: string, options: { signed?: boolean } = {}): string {
  return new Intl.NumberFormat(tag(locale), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: options.signed ? 'exceptZero' : 'auto',
  }).format(value)
}

/** Prices below 1 keep four decimals (penny stocks). */
export function formatPrice(value: number, currency: string, locale: string): string {
  const digits = Math.abs(value) < 1 ? 4 : 2
  return new Intl.NumberFormat(tag(locale), { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

export function formatQuantity(value: number, locale: string): string {
  return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: 6 }).format(value)
}

export function formatPercent(fraction: number, locale: string, options: { signed?: boolean } = {}): string {
  return new Intl.NumberFormat(tag(locale), {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: options.signed ? 'exceptZero' : 'auto',
  }).format(fraction)
}

export function formatDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`))
}

/** A number as the user would type it in the page language, without grouping (for edit forms). */
export function formatInputNumber(value: number | null, locale: string): string {
  if (value === null) return ''
  return new Intl.NumberFormat(tag(locale), { useGrouping: false, maximumFractionDigits: 10 }).format(value)
}
