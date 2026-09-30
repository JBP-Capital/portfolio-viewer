import { toCsv } from './csv.ts'
import { CSV_COLUMNS } from './import-rows.ts'

/** One stored transaction as it appears in the export. */
export interface ExportRecord {
  date: string
  portfolio: string
  /** Import types plus the merger legs exchange_out / exchange_in. */
  type: string
  isin: string | null
  symbol: string | null
  exchange: string | null
  quantity: number | null
  price: number | null
  currency: string
  fees: number
  taxes: number
  amount: number | null
  note: string | null
  /** Base currency per major unit of `currency` (per pound for GBX), as typed in the app. */
  fxRate: number | null
  splitRatio: number | null
  /** Pairs the two legs of a merger. */
  link: string | null
}

export const EXPORT_COLUMNS = CSV_COLUMNS

const plain = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 20 })
const num = (value: number | null) => (value === null ? '' : plain.format(value))

/** The export file: "," as delimiter, English numbers, ISO dates — readable by the importer again. */
export function exportCsv(records: readonly ExportRecord[]): string {
  return toCsv(
    EXPORT_COLUMNS,
    records.map((r) => [
      r.date, r.portfolio, r.type, r.isin ?? '', r.symbol ?? '', r.exchange ?? '', num(r.quantity), num(r.price), r.currency,
      num(r.fees), num(r.taxes), num(r.amount), r.note ?? '', num(r.fxRate), num(r.splitRatio), r.link ?? '',
    ]),
  )
}
