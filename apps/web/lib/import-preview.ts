import type { RowIssue } from '@pv/core'
import type { ImportIssue, ImportPlan } from '@pv/db'

export interface PreviewRow {
  line: number
  date: string
  portfolio: string
  type: string
  security: string | null
  quantity: number | null
  price: number | null
  amount: number | null
  currency: string
  status: 'ok' | 'warning' | 'error'
}

export interface ImportPreview {
  /** Set when the file can be imported; the confirmation refers to it instead of sending rows back. */
  draftId: string | null
  rows: PreviewRow[]
  issues: ImportIssue[]
  newPortfolios: string[]
  count: number
  blocked: boolean
}

/** What the import page shows: every row with its status, then the issues by line. */
export function buildPreview(rowIssues: readonly RowIssue[], plan: ImportPlan | null, draftId: string | null): ImportPreview {
  const issues: ImportIssue[] = [...rowIssues, ...(plan?.issues ?? [])].sort((a, b) => a.line - b.line)
  const statusOf = (line: number): PreviewRow['status'] => {
    const own = issues.filter((i) => i.line === line)
    if (own.some((i) => !i.warning)) return 'error'
    return own.length > 0 ? 'warning' : 'ok'
  }
  const rows = (plan?.rows ?? []).map((r) => ({
    line: r.line,
    date: r.date,
    portfolio: r.portfolio,
    type: r.type,
    security: r.security?.name ?? null,
    quantity: r.quantity,
    price: r.price,
    amount: r.amount,
    currency: r.currency,
    status: statusOf(r.line),
  }))
  const blocked = issues.some((i) => !i.warning) || rows.length === 0
  return { draftId: blocked ? null : draftId, rows, issues, newPortfolios: plan?.newPortfolios ?? [], count: rows.length, blocked }
}
