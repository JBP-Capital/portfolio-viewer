import type { CsvTable } from './csv.ts'
import { parseDecimalInput } from './decimal.ts'

/** Types a file may contain; merger legs come from exports and are paired by their `link`. */
export const IMPORT_TYPES = ['buy', 'sell', 'dividend', 'transfer_in', 'transfer_out', 'split', 'exchange_out', 'exchange_in'] as const
export type ImportType = (typeof IMPORT_TYPES)[number]

/** The column set of the CSV template and the export (spec §7), plus the optional rate columns. */
export const CSV_COLUMNS = ['date', 'portfolio', 'type', 'isin', 'symbol', 'exchange', 'quantity', 'price', 'currency', 'fees', 'taxes', 'amount', 'note', 'fx_rate', 'split_ratio', 'link'] as const

export const MAX_IMPORT_ROWS = 5000

export interface ImportRow {
  /** Line in the file; the header is line 1. */
  line: number
  date: string
  portfolio: string
  type: ImportType
  isin: string | null
  symbol: string | null
  /** Exchange as ISO 10383 MIC, e.g. XNYS. */
  exchange: string | null
  quantity: number | null
  price: number | null
  currency: string
  fees: number
  taxes: number
  amount: number | null
  fxRate: number | null
  splitRatio: number | null
  note: string | null
  /** Pairs the two legs of a merger. */
  link: string | null
}

export type RowIssueCode = 'missing_column' | 'required' | 'number' | 'date' | 'type' | 'security' | 'currency' | 'not_allowed' | 'too_many_rows'

export interface RowIssue {
  line: number
  column: string | null
  code: RowIssueCode
}

const REQUIRED_COLUMNS = ['date', 'portfolio', 'type', 'currency'] as const

/** Fields each type needs, in the order they are reported. */
const NEEDS: Record<ImportType, readonly ('quantity' | 'price' | 'amount' | 'split_ratio' | 'link')[]> = {
  buy: ['quantity', 'price'],
  sell: ['quantity', 'price'],
  transfer_in: ['quantity', 'price'],
  transfer_out: ['quantity'],
  dividend: ['amount'],
  split: ['split_ratio'],
  exchange_out: ['quantity', 'link'],
  exchange_in: ['quantity', 'link'],
}
/** Fees and taxes are only accepted on buys, sells and dividends (spec §5). */
const WITH_COSTS = new Set<ImportType>(['buy', 'sell', 'dividend'])

/** ISO 6166: two letters, nine alphanumerics, a Luhn check digit over the letters expanded to numbers. */
export function isValidIsin(isin: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return false
  const digits = [...isin].map((c) => (c >= 'A' ? String(c.charCodeAt(0) - 55) : c)).join('')
  let sum = 0
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/** "2026-01-05" or "05.01.2026" → "2026-01-05"; null for anything else or an impossible date. */
function readDate(text: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text)
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : german ? [german[3], german[2]!.padStart(2, '0'), german[1]!.padStart(2, '0')] : []
  if (!y || !m || !d) return null
  const date = `${y}-${m}-${d}`
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? null : date
}

const normalizeColumn = (name: string) => name.trim().toLowerCase().replace(/[\s-]+/g, '_')

/**
 * Checks every row of an import file. Numbers follow the delimiter: ";" files (German spreadsheets)
 * use German decimals, "," files English ones. Only rows without issues are returned in `rows`.
 */
export function readImportRows(csv: CsvTable): { rows: ImportRow[]; issues: RowIssue[] } {
  const columns = csv.header.map(normalizeColumn)
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c))
  if (missing.length > 0) return { rows: [], issues: missing.map((column) => ({ line: 1, column, code: 'missing_column' })) }
  if (csv.rows.length > MAX_IMPORT_ROWS) return { rows: [], issues: [{ line: 1, column: null, code: 'too_many_rows' }] }

  const locale = csv.delimiter === ';' ? 'de' : 'en'
  const rows: ImportRow[] = []
  const issues: RowIssue[] = []

  csv.rows.forEach((fields, index) => {
    const line = csv.lines[index] ?? index + 2
    const rowIssues: RowIssue[] = []
    const issue = (column: string, code: RowIssueCode) => rowIssues.push({ line, column, code })
    const text = (column: string) => {
      const i = columns.indexOf(column)
      return i === -1 ? '' : (fields[i] ?? '').trim()
    }
    const number = (column: string): number | null => {
      const raw = text(column)
      if (raw === '') return null
      const value = parseDecimalInput(raw, locale)
      if (value === null) issue(column, 'number')
      return value
    }

    const checked = (column: string, ok: (value: number) => boolean): number | null => {
      const value = number(column)
      if (value !== null && !ok(value)) {
        issue(column, 'number')
        return null
      }
      return value
    }
    const positive = (column: string) => checked(column, (v) => v > 0)
    const notNegative = (column: string) => checked(column, (v) => v >= 0)

    const date = readDate(text('date'))
    if (!date) issue('date', 'date')
    const portfolio = text('portfolio')
    if (!portfolio) issue('portfolio', 'required')
    const type = text('type').toLowerCase() as ImportType
    if (!IMPORT_TYPES.includes(type)) {
      issue('type', 'type')
      issues.push(...rowIssues)
      return
    }

    const isin = text('isin').toUpperCase() || null
    const symbol = text('symbol') || null
    const exchange = text('exchange').toUpperCase() || null
    if (isin) {
      if (!isValidIsin(isin)) issue('isin', 'security')
    } else if (!symbol) issue('symbol', 'security')
    else if (!exchange || !/^[A-Z0-9]{4}$/.test(exchange)) issue('exchange', 'security')

    const currency = text('currency')
    if (!/^[A-Z]{3}$/.test(currency)) issue('currency', 'currency')

    const values = { quantity: positive('quantity'), price: notNegative('price'), amount: notNegative('amount'), split_ratio: positive('split_ratio') }
    const fees = notNegative('fees')
    const taxes = notNegative('taxes')
    const fxRate = positive('fx_rate')
    for (const field of NEEDS[type]) if (text(field) === '') issue(field, 'required')
    if (!WITH_COSTS.has(type)) {
      if (fees !== null && fees !== 0) issue('fees', 'not_allowed')
      if (taxes !== null && taxes !== 0) issue('taxes', 'not_allowed')
    }

    if (rowIssues.length > 0) {
      issues.push(...rowIssues)
      return
    }
    const needs = new Set<string>(NEEDS[type])
    rows.push({
      line,
      date: date!,
      portfolio,
      type,
      isin,
      symbol,
      exchange,
      // A dividend may name the shares it was paid on.
      quantity: needs.has('quantity') || type === 'dividend' ? values.quantity : null,
      price: needs.has('price') ? values.price : null,
      currency,
      fees: fees ?? 0,
      taxes: taxes ?? 0,
      amount: needs.has('amount') ? values.amount : null,
      fxRate,
      splitRatio: needs.has('split_ratio') ? values.split_ratio : null,
      note: text('note') || null,
      link: needs.has('link') ? text('link') : null,
    })
  })
  return { rows, issues }
}
