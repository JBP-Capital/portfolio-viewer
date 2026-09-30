'use server'

import { parseCsv, readImportRows } from '@pv/core'
import { applyImportDraft, defaultSecurityResolver, ImportRejectedError, planImport, saveImportDraft } from '@pv/db'
import { revalidatePath } from 'next/cache'
import { requireMember } from '../../lib/auth/session.ts'
import { getDb } from '../../lib/db.ts'
import { buildPreview, type ImportPreview } from '../../lib/import-preview.ts'
import { getMarketProvider } from '../../lib/market.ts'

const MAX_BYTES = 2 * 1024 * 1024

export type PreviewResult = { ok: true; preview: ImportPreview } | { ok: false; error: 'no_file' | 'too_large' | 'empty' }
export type ConfirmResult =
  | { ok: true; transactions: number; portfolios: number }
  | { ok: false; error: 'expired' }
  | { ok: false; error: 'rejected'; preview: ImportPreview }

const resolver = () => defaultSecurityResolver(getDb(), getMarketProvider())

/** Checks an uploaded file; nothing is stored except the checked rows, for the confirmation. */
export async function previewImport(form: FormData): Promise<PreviewResult> {
  const member = await requireMember()
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'no_file' }
  if (file.size > MAX_BYTES) return { ok: false, error: 'too_large' }
  const { rows, issues } = readImportRows(parseCsv(await file.text()))
  if (rows.length === 0 && issues.length === 0) return { ok: false, error: 'empty' }
  const db = getDb()
  const plan = rows.length > 0 ? await planImport(db, member.id, rows, resolver()) : null
  const blocked = issues.length > 0 || !plan || plan.issues.some((i) => !i.warning)
  const draftId = blocked ? null : await saveImportDraft(db, member.id, rows)
  return { ok: true, preview: buildPreview(issues, plan, draftId) }
}

/** Stores the checked rows of a preview, all or none. */
export async function confirmImport(draftId: string): Promise<ConfirmResult> {
  const member = await requireMember()
  const db = getDb()
  try {
    // Uses the draft up in the same transaction: a second confirmation finds nothing.
    const result = await applyImportDraft(db, member.id, draftId, resolver())
    if (!result) return { ok: false, error: 'expired' }
    revalidatePath('/', 'layout')
    return { ok: true, ...result }
  } catch (error) {
    if (!(error instanceof ImportRejectedError)) throw error
    // Something changed since the preview (e.g. a sell entered meanwhile).
    return { ok: false, error: 'rejected', preview: buildPreview([], { rows: [], newPortfolios: [], issues: error.issues }, null) }
  }
}
