import { LedgerError } from '@pv/core'
import { FxRateMissingError, NotFoundError, ValidationError } from '@pv/db'
import { describe, expect, it, vi } from 'vitest'
import { toActionError } from '../lib/action-result.ts'

describe('toActionError', () => {
  it('turns domain errors into form errors', () => {
    expect(toActionError(new LedgerError('oversell', 't1', 'x'))).toEqual({ code: 'oversell' })
    expect(toActionError(new LedgerError('oversell', 't1', 'x', 6))).toEqual({ code: 'oversell', params: { held: '6' } })
    expect(toActionError(new FxRateMissingError('USD', '2026-01-05'))).toEqual({ code: 'fx_missing', params: { currency: 'USD', date: '2026-01-05' } })
    expect(toActionError(new ValidationError('x', [{ path: 'tradeDate', message: 'future' }]))).toEqual({ code: 'validation', field: 'tradeDate', params: { reason: 'future' } })
    expect(toActionError(new NotFoundError('Portfolio'))).toEqual({ code: 'not_found' })
  })

  it('hides unexpected errors', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(toActionError(new Error('database password is wrong'))).toEqual({ code: 'unknown' })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})
