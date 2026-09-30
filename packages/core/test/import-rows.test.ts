import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/csv.ts'
import { isValidIsin, readImportRows } from '../src/import-rows.ts'

const english = `date,portfolio,type,isin,symbol,exchange,quantity,price,currency,fees,taxes,amount,note
2026-01-05,Main,buy,CA0084741085,,,"1,000",12.5,USD,4.9,,,first
2026-02-02,Main,dividend,,AEM,XNYS,,,USD,,1.5,10,
2026-03-02,Main,split,CA0084741085,,,,,USD,,,,
`
const german = `Date;Portfolio;Type;ISIN;Symbol;Exchange;Quantity;Price;Currency;Fees;Taxes;Amount;Note;Split_Ratio
05.01.2026;Main;buy;CA0084741085;;;1.000;12,5;USD;4,9;;;first;
02.02.2026;Main;dividend;;AEM;XNYS;;;USD;;1,5;10;;
02.03.2026;Main;split;CA0084741085;;;;;USD;;;;;2
`

describe('readImportRows', () => {
  it('reads German and English files of the same trades alike', () => {
    const en = readImportRows(parseCsv(english))
    const de = readImportRows(parseCsv(german))
    expect(de.issues).toEqual([])
    expect(de.rows[0]).toEqual({
      line: 2, date: '2026-01-05', portfolio: 'Main', type: 'buy', isin: 'CA0084741085', symbol: null, exchange: null,
      quantity: 1000, price: 12.5, currency: 'USD', fees: 4.9, taxes: 0, amount: null, fxRate: null, splitRatio: null, note: 'first', link: null,
    })
    expect(de.rows[1]).toMatchObject({ type: 'dividend', symbol: 'AEM', exchange: 'XNYS', amount: 10, taxes: 1.5 })
    expect(de.rows[2]).toMatchObject({ type: 'split', splitRatio: 2 })
    // The English file has no split_ratio column, so its split row is incomplete; the rest is equal.
    expect(en.rows.slice(0, 2)).toEqual(de.rows.slice(0, 2))
    expect(en.issues).toEqual([{ line: 4, column: 'split_ratio', code: 'required' }])
  })

  it('names line and column of missing or malformed values', () => {
    const { issues } = readImportRows(parseCsv(`date,portfolio,type,isin,quantity,price,currency,fees
2026-01-05,Main,buy,CA0084741085,10,,USD,
2026-13-05,Main,buy,CA0084741085,x,1,USD,
2026-01-05,Main,merger,CA0084741085,1,1,USD,
2026-01-05,Main,transfer_out,CA0084741085,1,,USD,2
2026-01-05,Main,buy,CA0084741086,1,1,USD,
2026-01-05,,buy,CA0084741085,1,1,usd,
`))
    expect(issues).toEqual([
      { line: 2, column: 'price', code: 'required' },
      { line: 3, column: 'date', code: 'date' },
      { line: 3, column: 'quantity', code: 'number' },
      { line: 4, column: 'type', code: 'type' },
      { line: 5, column: 'fees', code: 'not_allowed' },
      { line: 6, column: 'isin', code: 'security' },
      { line: 7, column: 'portfolio', code: 'required' },
      { line: 7, column: 'currency', code: 'currency' },
    ])
  })

  it('reads merger legs of an export (they need their link) and keeps a dividend\'s share count', () => {
    const { rows, issues } = readImportRows(parseCsv(`date,portfolio,type,isin,quantity,price,currency,amount,link
2026-02-02,Main,exchange_out,CA0084741085,10,,EUR,,m1
2026-02-02,Main,exchange_in,DE0007164600,3,,EUR,,m1
2026-02-03,Main,exchange_in,DE0007164600,3,,EUR,,
2026-03-02,Main,dividend,CA0084741085,10,,USD,5,
`))
    expect(issues).toEqual([{ line: 4, column: 'link', code: 'required' }])
    expect(rows.map((r) => [r.type, r.quantity, r.link])).toEqual([['exchange_out', 10, 'm1'], ['exchange_in', 3, 'm1'], ['dividend', 10, null]])
  })

  it('names the file line even after blank lines and notes spanning lines', () => {
    const { issues } = readImportRows(parseCsv('date,portfolio,type,isin,quantity,price,currency,note\n\n2026-01-05,Main,buy,CA0084741085,1,1,USD,"two\nlines"\n2026-01-05,Main,buy,CA0084741085,1,,USD,\n'))
    expect(issues).toEqual([{ line: 5, column: 'price', code: 'required' }])
  })

  it('refuses negative quantities, prices and rates', () => {
    const { issues } = readImportRows(parseCsv('date,portfolio,type,isin,quantity,price,currency,fx_rate\n2026-01-05,Main,buy,CA0084741085,-1,-2,USD,0\n'))
    expect(issues).toEqual([
      { line: 2, column: 'quantity', code: 'number' },
      { line: 2, column: 'price', code: 'number' },
      { line: 2, column: 'fx_rate', code: 'number' },
    ])
  })

  it('needs the basic columns and a way to identify the security', () => {
    expect(readImportRows(parseCsv('date,type\n2026-01-05,buy\n')).issues).toEqual([
      { line: 1, column: 'portfolio', code: 'missing_column' },
      { line: 1, column: 'currency', code: 'missing_column' },
    ])
    expect(readImportRows(parseCsv('date,portfolio,type,currency,symbol,quantity,price\n2026-01-05,Main,buy,USD,AEM,1,1\n')).issues).toEqual([
      { line: 2, column: 'exchange', code: 'security' },
    ])
  })

  it('refuses more than 5,000 rows', () => {
    const rows = Array.from({ length: 5001 }, () => '2026-01-05,Main,buy,CA0084741085,1,1,USD').join('\n')
    expect(readImportRows(parseCsv(`date,portfolio,type,isin,quantity,price,currency\n${rows}\n`)).issues).toEqual([
      { line: 1, column: null, code: 'too_many_rows' },
    ])
  })
})

describe('isValidIsin', () => {
  it('checks the format and the check digit', () => {
    expect(isValidIsin('CA0084741085')).toBe(true)
    expect(isValidIsin('DE0007164600')).toBe(true)
    expect(isValidIsin('US0378331005')).toBe(true)
    expect(isValidIsin('CA0084741086')).toBe(false)
    expect(isValidIsin('CA008474108')).toBe(false)
  })
})
