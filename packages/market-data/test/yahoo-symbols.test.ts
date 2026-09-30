import { describe, expect, it } from 'vitest'
import { fromYahooSymbol, toYahooSymbol } from '../src/yahoo-symbols.ts'

describe('Yahoo symbols', () => {
  it('adds the exchange suffix', () => {
    expect(toYahooSymbol({ mic: 'XNYS', symbol: 'AEM' })).toBe('AEM')
    expect(toYahooSymbol({ mic: 'XTSX', symbol: 'LG' })).toBe('LG.V')
    expect(toYahooSymbol({ mic: 'XFRA', symbol: 'AE9' })).toBe('AE9.F')
    expect(toYahooSymbol({ mic: 'XETR', symbol: '4GLD' })).toBe('4GLD.DE')
    expect(toYahooSymbol({ mic: 'XLON', symbol: 'FRES' })).toBe('FRES.L')
  })
  it('knows no symbol for an exchange it does not map, instead of guessing a US listing', () => {
    expect(toYahooSymbol({ mic: 'XTAE', symbol: 'TEVA' })).toBeNull()
  })
  it('maps Yahoo exchange codes back to MIC and bare symbol', () => {
    expect(fromYahooSymbol('AEM.TO', 'TOR')).toEqual({ mic: 'XTSE', symbol: 'AEM' })
    expect(fromYahooSymbol('LGCXF', 'PNK')).toEqual({ mic: 'OTCM', symbol: 'LGCXF' })
    expect(fromYahooSymbol('RIO.AX', 'ASX')).toEqual({ mic: 'XASX', symbol: 'RIO' })
    expect(fromYahooSymbol('XYZ.QQ', 'QQQ')).toBeNull()
  })
})
