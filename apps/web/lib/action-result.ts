import { LedgerError } from '@pv/core'
import { FxRateMissingError, NotFoundError, ValidationError } from '@pv/db'

export type ActionErrorCode = 'oversell' | 'unpaired_exchange' | 'fx_missing' | 'validation' | 'not_found' | 'invalid_number' | 'unknown'

export interface ActionError {
  code: ActionErrorCode
  field?: string
  params?: Record<string, string>
}

export type ActionResult = { ok: true } | { ok: false; error: ActionError }

/** Domain errors become form messages; anything unexpected is logged and hidden from the page. */
export function toActionError(error: unknown): ActionError {
  if (error instanceof LedgerError) {
    if (error.code === 'oversell') return error.held === undefined ? { code: 'oversell' } : { code: 'oversell', params: { held: String(error.held) } }
    if (error.code === 'unpaired_exchange') return { code: 'unpaired_exchange' }
    return { code: 'validation' }
  }
  if (error instanceof FxRateMissingError) return { code: 'fx_missing', params: { currency: error.currency, date: error.date } }
  if (error instanceof ValidationError) {
    const issue = error.issues[0]
    return issue ? { code: 'validation', field: issue.path, params: { reason: issue.message } } : { code: 'validation' }
  }
  if (error instanceof NotFoundError) return { code: 'not_found' }
  console.error('[action] unexpected error', error)
  return { code: 'unknown' }
}
