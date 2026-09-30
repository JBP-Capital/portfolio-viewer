import { describe, expect, it } from 'vitest'
import { isRegularSplit } from '../src/splits.ts'

describe('isRegularSplit', () => {
  it('recognises ordinary and reverse splits', () => {
    expect(isRegularSplit(4, 1)).toBe(true)
    expect(isRegularSplit(3, 2)).toBe(true)
    expect(isRegularSplit(1, 8)).toBe(true)
    expect(isRegularSplit(20, 1)).toBe(true)
  })
  it('does not take spin-off adjustments for splits', () => {
    expect(isRegularSplit(1281, 1000)).toBe(false)
    expect(isRegularSplit(1253, 1000)).toBe(false)
  })
  it('rejects impossible ratios', () => {
    expect(isRegularSplit(0, 1)).toBe(false)
    expect(isRegularSplit(1, 0)).toBe(false)
    expect(isRegularSplit(1.5, 1)).toBe(false)
    expect(isRegularSplit(1, 1)).toBe(false)
  })
})
