import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from '../src/csv.ts'

describe('parseCsv', () => {
  it('reads quoted fields with delimiters, quotes and line breaks', () => {
    const csv = parseCsv('date,note\n2026-01-05,"Kauf, ""erste"" Tranche\nmit Umbruch"\n')
    expect(csv).toEqual({ delimiter: ',', header: ['date', 'note'], rows: [['2026-01-05', 'Kauf, "erste" Tranche\nmit Umbruch']], lines: [2] })
  })

  it('detects the semicolon of German spreadsheets and ignores a BOM, CRLF and empty trailing lines', () => {
    const csv = parseCsv('﻿date;price\r\n05.01.2026;12,5\r\n\r\n')
    expect(csv).toEqual({ delimiter: ';', header: ['date', 'price'], rows: [['05.01.2026', '12,5']], lines: [2] })
  })

  it('keeps rows with too many or too few fields as they are', () => {
    expect(parseCsv('a,b\n1,2,3\n4\n').rows).toEqual([['1', '2', '3'], ['4']])
  })

  it('reads a quote inside an unquoted field literally instead of swallowing later rows', () => {
    const csv = parseCsv('date,note\n2026-01-05,12" vinyl\n2026-01-06,plain\n2026-01-07,"x"\n')
    expect(csv.rows).toEqual([['2026-01-05', '12" vinyl'], ['2026-01-06', 'plain'], ['2026-01-07', 'x']])
  })

  it('drops rows made of delimiters only, as spreadsheets write them', () => {
    expect(parseCsv('a;b\n;;\n1;2\n ; \n').rows).toEqual([['1', '2']])
  })

  it('knows the file line on which each row starts', () => {
    expect(parseCsv('a,b\n\n1,"x\ny"\n2,z\n').lines).toEqual([3, 5])
  })

  it('returns an empty table for an empty file', () => {
    expect(parseCsv('')).toEqual({ delimiter: ',', header: [], rows: [], lines: [] })
  })
})

describe('toCsv', () => {
  it('quotes only where needed and reads back to the same table', () => {
    const header = ['date', 'note']
    const rows = [['2026-01-05', 'plain'], ['2026-01-06', 'a, "b"\nc'], ['2026-01-07', '']]
    const text = toCsv(header, rows)
    expect(text).toBe('date,note\n2026-01-05,plain\n2026-01-06,"a, ""b""\nc"\n2026-01-07,\n')
    expect(parseCsv(text)).toMatchObject({ delimiter: ',', header, rows })
  })
})
