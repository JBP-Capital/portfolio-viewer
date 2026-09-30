import { describe, expect, it } from 'vitest'
import { changeField } from '../lib/transaction-form.ts'

const values = { tradeDate: '2024-01-02', fxRate: '0,91', quantity: '10' }

describe('changeField', () => {
  it('drops the pre-filled exchange rate when the date of an entry changes', () => {
    expect(changeField(values, 'tradeDate', '2025-06-01', '0,91')).toEqual({ tradeDate: '2025-06-01', fxRate: '', quantity: '10' })
  })
  it('keeps a rate the member typed in this form', () => {
    expect(changeField({ ...values, fxRate: '0,95' }, 'tradeDate', '2025-06-01', '0,91').fxRate).toBe('0,95')
  })
  it('changes only the field itself otherwise', () => {
    expect(changeField(values, 'quantity', '12', '0,91')).toEqual({ ...values, quantity: '12' })
    expect(changeField(values, 'tradeDate', '2025-06-01', '')).toEqual({ ...values, tradeDate: '2025-06-01' })
  })
})
