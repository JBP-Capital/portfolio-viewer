const PLAIN = /^-?\d+(\.\d+)?$/

/**
 * Reads a number typed in the page language. German: "1.234,56"; English: "1,234.56". A lone
 * separator followed by groups of exactly three digits ("1.000" / "1,000") is a thousands separator,
 * unless the number starts with 0 ("0.385" is a penny-stock price, never 385); otherwise a lone "," or
 * "." is the decimal mark, so "12,5" and "12.5" both mean twelve and a half. With both separators the
 * language decides which is which, and anything out of place ("1.234,56" in English) is refused.
 */
export function parseDecimalInput(text: string, locale: 'en' | 'de'): number | null {
  const compact = text.replace(/[\s\u00a0\u202f']/g, '')
  if (compact === '') return null
  const group = locale === 'de' ? '.' : ','
  const decimal = locale === 'de' ? ',' : '.'
  const grouped = new RegExp(`^-?[1-9]\\d{0,2}(\\${group}\\d{3})+$`)
  let normalized: string
  if (compact.includes(decimal) && compact.includes(group)) {
    const [whole, fraction, ...rest] = compact.split(decimal)
    if (rest.length > 0 || fraction === undefined || fraction.includes(group) || !grouped.test(whole ?? '')) return null
    normalized = `${whole!.split(group).join('')}.${fraction}`
  } else if (grouped.test(compact)) {
    normalized = compact.split(group).join('')
  } else {
    normalized = compact.replace(/,/g, '.')
  }
  return PLAIN.test(normalized) ? Number(normalized) : null
}
