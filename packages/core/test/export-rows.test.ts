import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/csv.ts'
import { exportCsv, type ExportRecord } from '../src/export-rows.ts'
import { readImportRows } from '../src/import-rows.ts'

const records: ExportRecord[] = [
  { date: '2026-01-05', portfolio: 'Main, "family"', type: 'buy', isin: 'CA0084741085', symbol: 'AEM', exchange: 'XNYS', quantity: 39900, price: 0.2367, currency: 'USD', fees: 4.9, taxes: 0, amount: null, note: 'first\nline', fxRate: 0.000000123, splitRatio: null, link: null },
  { date: '2026-02-02', portfolio: 'Main', type: 'dividend', isin: null, symbol: 'SAP', exchange: 'XETR', quantity: 12, price: null, currency: 'EUR', fees: 0, taxes: 1.5, amount: 10, note: null, fxRate: 1, splitRatio: null, link: null },
  { date: '2026-03-02', portfolio: 'Main', type: 'split', isin: 'CA0084741085', symbol: 'AEM', exchange: 'XNYS', quantity: null, price: null, currency: 'USD', fees: 0, taxes: 0, amount: null, note: null, fxRate: 1, splitRatio: 4, link: null },
]

describe('exportCsv', () => {
  it('writes a file that the importer reads back to the same transactions', () => {
    const { rows, issues } = readImportRows(parseCsv(exportCsv(records)))
    expect(issues).toEqual([])
    expect(rows.map(({ line: _line, ...rest }) => rest)).toEqual(records)
  })

  it('writes plain numbers without exponents or grouping', () => {
    const text = exportCsv(records)
    expect(text).toContain(',39900,0.2367,USD,4.9,0,,')
    expect(text).toContain('0.000000123')
  })

  it('keeps merger legs with their link, and the importer reads them back', () => {
    const legs: ExportRecord[] = [
      { ...records[0]!, type: 'exchange_out', link: 'l1', price: null, fees: 0 },
      { ...records[0]!, type: 'exchange_in', link: 'l1', price: null, fees: 0 },
    ]
    const text = exportCsv(legs)
    expect(text.split('\n')[0]).toBe('date,portfolio,type,isin,symbol,exchange,quantity,price,currency,fees,taxes,amount,note,fx_rate,split_ratio,link')
    const back = readImportRows(parseCsv(text))
    expect(back.issues).toEqual([])
    expect(back.rows.map((r) => [r.type, r.link])).toEqual([['exchange_out', 'l1'], ['exchange_in', 'l1']])
  })
})
