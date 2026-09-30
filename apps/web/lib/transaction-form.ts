/**
 * One field of the transaction form changes. When the date of a stored entry changes, its pre-filled
 * exchange rate (the rate of the old date) is dropped, so the reference rate of the new date applies —
 * unless the member already typed a different rate in this form.
 */
export function changeField<V extends { tradeDate: string; fxRate: string }>(values: V, name: keyof V, value: string, prefilledFxRate: string): V {
  const next = { ...values, [name]: value }
  if (name === 'tradeDate' && value !== values.tradeDate && prefilledFxRate !== '' && values.fxRate === prefilledFxRate) next.fxRate = ''
  return next
}
