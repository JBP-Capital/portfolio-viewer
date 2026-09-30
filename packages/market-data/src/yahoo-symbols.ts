import type { ListingRef } from './types.ts'

/** Yahoo exchange codes (search results, chart meta) → ISO MIC. */
const EXCHANGE_TO_MIC: Record<string, string> = {
  NYQ: 'XNYS', NMS: 'XNAS', NGM: 'XNAS', NCM: 'XNAS', NAS: 'XNAS', ASE: 'XASE', PCX: 'ARCX', BTS: 'BATS',
  PNK: 'OTCM', OQB: 'OTCM', OQX: 'OTCM', OEM: 'OTCM', OBB: 'OTCM', OGM: 'OTCM',
  TOR: 'XTSE', VAN: 'XTSX', CNQ: 'XCNQ', NEO: 'NEOE',
  LSE: 'XLON',
  GER: 'XETR', FRA: 'XFRA', STU: 'XSTU', MUN: 'XMUN', BER: 'XBER', DUS: 'XDUS', HAM: 'XHAM',
  PAR: 'XPAR', AMS: 'XAMS', BRU: 'XBRU', LIS: 'XLIS', ISE: 'XDUB', MIL: 'XMIL', MCE: 'XMAD', VIE: 'XWBO', EBS: 'XSWX',
  STO: 'XSTO', OSL: 'XOSL', CPH: 'XCSE', HEL: 'XHEL',
  ASX: 'XASX', NZE: 'XNZE', HKG: 'XHKG', JPX: 'XTKS', JNB: 'XJSE',
}

/** ISO MIC → Yahoo symbol suffix. */
const MIC_TO_SUFFIX: Record<string, string> = {
  XNYS: '', XNAS: '', XASE: '', ARCX: '', BATS: '', OTCM: '',
  XTSE: '.TO', XTSX: '.V', XCNQ: '.CN', NEOE: '.NE',
  XLON: '.L',
  XETR: '.DE', XFRA: '.F', XSTU: '.SG', XMUN: '.MU', XBER: '.BE', XDUS: '.DU', XHAM: '.HM',
  XPAR: '.PA', XAMS: '.AS', XBRU: '.BR', XLIS: '.LS', XDUB: '.IR', XMIL: '.MI', XMAD: '.MC', XWBO: '.VI', XSWX: '.SW',
  XSTO: '.ST', XOSL: '.OL', XCSE: '.CO', XHEL: '.HE',
  XASX: '.AX', XNZE: '.NZ', XHKG: '.HK', XTKS: '.T', XJSE: '.JO',
}

/** Null for exchanges without a known suffix: a bare symbol would silently pick a US listing. */
export function toYahooSymbol(ref: ListingRef): string | null {
  const suffix = MIC_TO_SUFFIX[ref.mic]
  return suffix === undefined ? null : `${ref.symbol}${suffix}`
}

export function fromYahooSymbol(symbol: string, exchangeCode: string): ListingRef | null {
  const mic = EXCHANGE_TO_MIC[exchangeCode]
  if (!mic) return null
  const suffix = MIC_TO_SUFFIX[mic] ?? ''
  return { mic, symbol: suffix && symbol.endsWith(suffix) ? symbol.slice(0, -suffix.length) : symbol }
}
