import { BASE_CURRENCIES } from '@pv/core'
import { defaultFetch, getText } from './http.ts'
import type { FetchLike, FxDailyRate, FxHistoryProvider } from './types.ts'

const BASE = 'https://data-api.ecb.europa.eu/service/data/EXR'

/** Parses the ECB SDMX "csvdata" format with `detail=dataonly` (no quoted text columns). */
export function parseEcbCsv(text: string): FxDailyRate[] {
  const [header, ...lines] = text.trim().split(/\r?\n/)
  const columns = (header ?? '').split(',')
  const currencyAt = columns.indexOf('CURRENCY')
  const dateAt = columns.indexOf('TIME_PERIOD')
  const valueAt = columns.indexOf('OBS_VALUE')
  const rows: FxDailyRate[] = []
  for (const line of lines) {
    const cells = line.split(',')
    const perEur = Number(cells[valueAt])
    const currency = cells[currencyAt]
    const date = cells[dateAt]
    if (currency && date && Number.isFinite(perEur) && perEur > 0) rows.push({ currency, date, perEur })
  }
  return rows
}

/** ECB euro reference rates, published on working days around 16:00 CET. */
export function createEcbProvider(fetchImpl: FetchLike = defaultFetch): FxHistoryProvider {
  return {
    id: 'ecb',
    currencies: BASE_CURRENCIES.filter((c) => c !== 'EUR'),
    async dailyRates(currencies, from) {
      const codes = [...new Set(currencies.filter((c) => c !== 'EUR'))]
      if (codes.length === 0) return []
      const url = `${BASE}/D.${codes.join('+')}.EUR.SP00.A?format=csvdata&detail=dataonly&startPeriod=${from}`
      return parseEcbCsv(await getText(url, fetchImpl))
    },
  }
}
