import type { ImportRow } from '@pv/core'
import type { ImportPlan } from '@pv/db'
import { describe, expect, it } from 'vitest'
import { buildPreview } from '../lib/import-preview.ts'

const row = (line: number): ImportRow => ({
  line, date: '2026-01-05', portfolio: 'Main', type: 'buy', isin: null, symbol: 'AEM', exchange: 'XNYS',
  quantity: 10, price: 100, currency: 'USD', fees: 0, taxes: 0, amount: null, fxRate: null, splitRatio: null, note: null, link: null,
})
const security = { instrumentId: 'i', listingId: 'l', name: 'Agnico Eagle Mines', currency: 'USD' }

describe('buildPreview', () => {
  it('marks each row by its worst issue and blocks only on errors', () => {
    const plan: ImportPlan = {
      rows: [{ ...row(2), security, portfolioId: 'p' }, { ...row(3), security: null, portfolioId: null }, { ...row(4), security, portfolioId: 'p' }],
      newPortfolios: [],
      issues: [{ line: 3, column: 'symbol', code: 'security' }, { line: 4, column: null, code: 'duplicate', warning: true }],
    }
    const preview = buildPreview([], plan, null)
    expect(preview.rows.map((r) => [r.line, r.security, r.status])).toEqual([
      [2, 'Agnico Eagle Mines', 'ok'],
      [3, null, 'error'],
      [4, 'Agnico Eagle Mines', 'warning'],
    ])
    expect(preview.blocked).toBe(true)
    expect(buildPreview([], { ...plan, issues: [plan.issues[1]!] }, 'draft').blocked).toBe(false)
  })

  it('puts file-level issues first and counts importable rows', () => {
    const preview = buildPreview([{ line: 5, column: 'date', code: 'date' }], { rows: [{ ...row(2), security, portfolioId: 'p' }], newPortfolios: ['New'], issues: [] }, null)
    expect(preview.issues).toEqual([{ line: 5, column: 'date', code: 'date' }])
    expect(preview).toMatchObject({ count: 1, newPortfolios: ['New'], blocked: true, draftId: null })
  })
})
