# Market data (sub-project 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prices, price history, dividends, splits and exchange rates flow into the database automatically for every security any member holds, from free sources (Yahoo, ECB), through a pluggable provider interface.

**Architecture:** `packages/market-data` defines `MarketDataProvider` / `FxHistoryProvider` and implements them for Yahoo (quotes, search, history, intraday FX) and the ECB (daily reference rates). `packages/db` gets the market tables and the repository functions the worker needs. `apps/worker` runs the jobs on a schedule (croner) and records each run in `job_status`. Closes are stored **unadjusted** (Yahoo's split-adjusted closes are converted back), because the ledger works with the real share counts.

**Tech Stack:** as sub-project 1, plus croner 10. Node 24 runs the worker's TypeScript directly (type stripping, no build step).

**Spec:** `docs/superpowers/specs/2026-09-26-portfolio-viewer-design.md` §4 (market tables), §6 (market data), §10.

## Global Constraints

- Everything in the repository is English.
- Listings are identified by ISO MIC + symbol; adapters map MICs to their own symbols.
- Currency codes are stored upper-case three letters; Yahoo's `GBp` / `ZAc` become `GBX` / `ZAC` (minor units, see `toMajorUnit`).
- `daily_prices.close` is the real (unadjusted) close in the listing currency.
- The worker never touches tenant data (members, portfolios, transactions) except reading which listings are in use.
- No network access in unit tests: adapters take an injectable `fetch`; recorded responses live in `packages/market-data/test/fixtures/`. One opt-in live test (`LIVE_MARKET_DATA=1`) checks the real services.

## Review Focus

- A stock split inside the fetched history (Apple 4:1 on 2020-08-31) must give the real close before the split (≈ 499.24, not 124.81) → test in Task 3.
- A London listing quoted in pence must be stored with currency `GBX`, not `GBP` → test in Task 3.
- One unknown or failing symbol must not stop the quotes or backfill of all other listings → test in Task 6.
- Listings of an exchange that is closed (weekend, night) must not be polled → tests in Tasks 2 and 6.
- A second backfill run must not download ten years of history again for a listing that already has it → test in Task 6.

---

### Task 1: CI builds the web app; pinned secret scanner

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1:** In `.github/workflows/ci.yml` add after `npm test`:
```yaml
      - run: npm run build -w @pv/web
```
and pin the scanner: replace `ghcr.io/gitleaks/gitleaks:latest` with `ghcr.io/gitleaks/gitleaks:v8.30.1`.

- [ ] **Step 2: Verify locally** — `npm run build -w @pv/web` → exit 0; `docker run --rm -v "$(pwd -W):/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --redact` → "no leaks found".

- [ ] **Step 3: Commit** — `git commit -m "ci: build the web app and pin gitleaks" -- .github/workflows/ci.yml`

---

### Task 2: Exchanges, trading hours, currency codes and instrument types in core

**Files:**
- Create: `packages/core/src/exchanges.ts`, `packages/core/src/instruments.ts`
- Modify: `packages/core/src/currency.ts`, `packages/core/src/index.ts`, `packages/db/src/schema.ts`, `packages/db/src/instruments.ts`
- Test: `packages/core/test/exchanges.test.ts`, `packages/core/test/currency.test.ts`

**Interfaces:**
- Produces: `interface Exchange { mic; name; country; timezone; open: 'HH:MM'; close: 'HH:MM' }`, `EXCHANGES: Record<string, Exchange>`, `isExchangeOpen(mic, now, graceMinutes = 30): boolean` (unknown MIC → true); `normalizeCurrencyCode(code): string`; `INSTRUMENT_TYPES`, `type InstrumentType`.

- [ ] **Step 1: Failing tests** — `packages/core/test/exchanges.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { EXCHANGES, isExchangeOpen } from '../src/exchanges.ts'

describe('isExchangeOpen', () => {
  it('knows New York trading hours with a grace period after the close', () => {
    expect(isExchangeOpen('XNYS', new Date('2026-09-28T15:00:00Z'))).toBe(true) // Monday 11:00 New York
    expect(isExchangeOpen('XNYS', new Date('2026-09-28T13:00:00Z'))).toBe(false) // 09:00, before the open
    expect(isExchangeOpen('XNYS', new Date('2026-09-28T20:15:00Z'))).toBe(true) // 16:15, inside the grace
    expect(isExchangeOpen('XNYS', new Date('2026-09-28T21:00:00Z'))).toBe(false) // 17:00
  })
  it('is closed on weekends', () => {
    expect(isExchangeOpen('XNYS', new Date('2026-09-26T15:00:00Z'))).toBe(false) // Saturday
    expect(isExchangeOpen('XETR', new Date('2026-09-27T10:00:00Z'))).toBe(false) // Sunday
  })
  it('uses the exchange time zone', () => {
    expect(isExchangeOpen('XFRA', new Date('2026-09-28T19:30:00Z'))).toBe(true) // 21:30 Frankfurt
    expect(isExchangeOpen('XASX', new Date('2026-09-28T01:00:00Z'))).toBe(true) // 11:00 Sydney
    expect(isExchangeOpen('XASX', new Date('2026-09-28T12:00:00Z'))).toBe(false) // 22:00 Sydney
  })
  it('treats unknown exchanges as open so they are never silently skipped', () => {
    expect(isExchangeOpen('XXXX', new Date('2026-09-26T15:00:00Z'))).toBe(true)
  })
  it('describes the exchanges held in the reference portfolio', () => {
    for (const mic of ['XNYS', 'XNAS', 'OTCM', 'XTSE', 'XTSX', 'XLON', 'XETR', 'XFRA', 'XASX']) expect(EXCHANGES[mic]).toBeDefined()
  })
})
```

Add to `packages/core/test/currency.test.ts`:
```ts
import { normalizeCurrencyCode } from '../src/currency.ts'

describe('normalizeCurrencyCode', () => {
  it('maps provider spellings of minor units to three upper-case letters', () => {
    expect(normalizeCurrencyCode('GBp')).toBe('GBX')
    expect(normalizeCurrencyCode('ZAc')).toBe('ZAC')
    expect(normalizeCurrencyCode('usd')).toBe('USD')
    expect(normalizeCurrencyCode('ILA')).toBe('ILA')
  })
})
```

- [ ] **Step 2: Run to see them fail** — `npm test -w @pv/core` → FAIL (modules / export missing).

- [ ] **Step 3: Implement** — `packages/core/src/exchanges.ts`
```ts
import { todayInTimeZone } from './dates.ts'

export interface Exchange {
  mic: string
  name: string
  country: string
  timezone: string
  /** Local opening time, HH:MM. */
  open: string
  /** Local closing time, HH:MM. */
  close: string
}

function exchange(mic: string, name: string, country: string, timezone: string, open: string, close: string): [string, Exchange] {
  return [mic, { mic, name, country, timezone, open, close }]
}

const NY = 'America/New_York'
const TORONTO = 'America/Toronto'
const BERLIN = 'Europe/Berlin'

export const EXCHANGES: Record<string, Exchange> = Object.fromEntries([
  exchange('XNYS', 'New York Stock Exchange', 'US', NY, '09:30', '16:00'),
  exchange('XNAS', 'Nasdaq', 'US', NY, '09:30', '16:00'),
  exchange('XASE', 'NYSE American', 'US', NY, '09:30', '16:00'),
  exchange('ARCX', 'NYSE Arca', 'US', NY, '09:30', '16:00'),
  exchange('BATS', 'Cboe BZX', 'US', NY, '09:30', '16:00'),
  exchange('OTCM', 'OTC Markets', 'US', NY, '09:30', '16:00'),
  exchange('XTSE', 'Toronto Stock Exchange', 'CA', TORONTO, '09:30', '16:00'),
  exchange('XTSX', 'TSX Venture Exchange', 'CA', TORONTO, '09:30', '16:00'),
  exchange('XCNQ', 'Canadian Securities Exchange', 'CA', TORONTO, '09:30', '16:00'),
  exchange('NEOE', 'Cboe Canada', 'CA', TORONTO, '09:30', '16:00'),
  exchange('XLON', 'London Stock Exchange', 'GB', 'Europe/London', '08:00', '16:30'),
  exchange('XETR', 'Xetra', 'DE', BERLIN, '09:00', '17:30'),
  exchange('XFRA', 'Frankfurt', 'DE', BERLIN, '08:00', '22:00'),
  exchange('XSTU', 'Stuttgart', 'DE', BERLIN, '08:00', '22:00'),
  exchange('XMUN', 'Munich', 'DE', BERLIN, '08:00', '22:00'),
  exchange('XBER', 'Berlin', 'DE', BERLIN, '08:00', '22:00'),
  exchange('XDUS', 'Düsseldorf', 'DE', BERLIN, '08:00', '22:00'),
  exchange('XHAM', 'Hamburg', 'DE', BERLIN, '08:00', '22:00'),
  exchange('XPAR', 'Euronext Paris', 'FR', 'Europe/Paris', '09:00', '17:30'),
  exchange('XAMS', 'Euronext Amsterdam', 'NL', 'Europe/Amsterdam', '09:00', '17:30'),
  exchange('XBRU', 'Euronext Brussels', 'BE', 'Europe/Brussels', '09:00', '17:30'),
  exchange('XLIS', 'Euronext Lisbon', 'PT', 'Europe/Lisbon', '08:00', '16:30'),
  exchange('XDUB', 'Euronext Dublin', 'IE', 'Europe/Dublin', '08:00', '16:30'),
  exchange('XMIL', 'Borsa Italiana', 'IT', 'Europe/Rome', '09:00', '17:30'),
  exchange('XMAD', 'Bolsa de Madrid', 'ES', 'Europe/Madrid', '09:00', '17:30'),
  exchange('XWBO', 'Wiener Börse', 'AT', 'Europe/Vienna', '09:00', '17:30'),
  exchange('XSWX', 'SIX Swiss Exchange', 'CH', 'Europe/Zurich', '09:00', '17:30'),
  exchange('XSTO', 'Nasdaq Stockholm', 'SE', 'Europe/Stockholm', '09:00', '17:30'),
  exchange('XOSL', 'Oslo Børs', 'NO', 'Europe/Oslo', '09:00', '16:20'),
  exchange('XCSE', 'Nasdaq Copenhagen', 'DK', 'Europe/Copenhagen', '09:00', '17:00'),
  exchange('XHEL', 'Nasdaq Helsinki', 'FI', 'Europe/Helsinki', '10:00', '18:30'),
  exchange('XASX', 'Australian Securities Exchange', 'AU', 'Australia/Sydney', '10:00', '16:00'),
  exchange('XNZE', 'NZX', 'NZ', 'Pacific/Auckland', '10:00', '16:45'),
  exchange('XHKG', 'Hong Kong Exchange', 'HK', 'Asia/Hong_Kong', '09:30', '16:00'),
  exchange('XTKS', 'Tokyo Stock Exchange', 'JP', 'Asia/Tokyo', '09:00', '15:30'),
  exchange('XJSE', 'Johannesburg Stock Exchange', 'ZA', 'Africa/Johannesburg', '09:00', '17:00'),
])

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

function localWeekdayAndMinutes(timeZone: string, now: Date): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

/**
 * True on weekdays between the local open and the close plus a grace period, so the final prices of
 * the day are still picked up. Holidays are not modelled (a few extra requests are harmless).
 */
export function isExchangeOpen(mic: string, now: Date, graceMinutes = 30): boolean {
  const ex = EXCHANGES[mic]
  if (!ex) return true
  const local = localWeekdayAndMinutes(ex.timezone, now)
  if (local.weekday === 'Sat' || local.weekday === 'Sun') return false
  return local.minutes >= minutes(ex.open) && local.minutes <= minutes(ex.close) + graceMinutes
}

/** The trading date of an exchange at a moment (its local calendar date). */
export function exchangeDate(mic: string, at: Date): string {
  return todayInTimeZone(EXCHANGES[mic]?.timezone ?? 'UTC', at)
}
```

Append to `packages/core/src/currency.ts`:
```ts
const PROVIDER_SPELLINGS: Record<string, string> = { GBp: 'GBX', ZAc: 'ZAC' }

/** Provider currency codes as stored: three upper-case letters, minor units keep their own code. */
export function normalizeCurrencyCode(code: string): string {
  return PROVIDER_SPELLINGS[code] ?? code.toUpperCase()
}
```

`packages/core/src/instruments.ts`:
```ts
export const INSTRUMENT_TYPES = ['stock', 'etf', 'etc', 'fund', 'bond', 'index', 'other'] as const
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number]
```

`packages/core/src/index.ts` — add `export * from './exchanges.ts'` and `export * from './instruments.ts'`.

`packages/db/src/schema.ts` — import `INSTRUMENT_TYPES` from `@pv/core` and use `pgEnum('instrument_type', INSTRUMENT_TYPES)`.
`packages/db/src/instruments.ts` — `type?: InstrumentType` (from `@pv/core`) instead of the enum lookup; add optional `sector?: string | null` and `country?: string | null` to `ListingInput`, written on instrument creation.

- [ ] **Step 4: Verify** — `npm test -w @pv/core` → PASS; `npm run generate -w @pv/db` → "No schema changes"; `npm test -w @pv/db` → PASS; `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit** — `git commit -m "feat(core): exchange trading hours, provider currency codes, instrument types" -- packages/core packages/db/src`

---

### Task 3: Market data interface and the Yahoo adapter

**Files:**
- Create: `packages/market-data/package.json`, `packages/market-data/tsconfig.json`, `packages/market-data/src/types.ts`, `packages/market-data/src/http.ts`, `packages/market-data/src/yahoo-symbols.ts`, `packages/market-data/src/yahoo.ts`, `packages/market-data/src/index.ts`
- Create (recorded): `packages/market-data/test/fixtures/yahoo-search-agnico.json`, `yahoo-chart-aapl-split.json`, `yahoo-chart-fres.json`, `yahoo-spark-quotes.json`, `yahoo-spark-fx.json`
- Modify: root `package.json` (workspace `packages/market-data`)
- Test: `packages/market-data/test/yahoo-symbols.test.ts`, `packages/market-data/test/yahoo.test.ts`

**Interfaces:**
- Consumes: `todayInTimeZone`, `normalizeCurrencyCode`, `InstrumentType` (core).
- Produces (types.ts):
```ts
export interface ListingRef { mic: string; symbol: string }
export interface ListingCandidate extends ListingRef { name: string; type: InstrumentType; exchangeName: string; sector: string | null }
export interface ListingDetails extends ListingRef { name: string; currency: string; type: InstrumentType }
export interface QuotePoint { ts: Date; price: number }
export interface Quote { ref: ListingRef; price: number; previousClose: number | null; asOf: Date; points: QuotePoint[] }
export interface DailyBar { date: string; close: number }
export interface DividendEvent { exDate: string; amount: number }
export interface SplitEvent { date: string; ratio: number }
export interface DailyHistory { bars: DailyBar[]; dividends: DividendEvent[]; splits: SplitEvent[] }
export interface FxQuote { currency: string; perEur: number; asOf: Date }
export interface FxDailyRate { currency: string; date: string; perEur: number }
export interface MarketDataProvider {
  readonly id: string
  search(query: string): Promise<ListingCandidate[]>
  describe(ref: ListingRef): Promise<ListingDetails | null>
  quotes(refs: readonly ListingRef[]): Promise<Quote[]>
  dailyHistory(ref: ListingRef, from: string): Promise<DailyHistory>
  fxLatest(currencies: readonly string[]): Promise<FxQuote[]>
}
export interface FxHistoryProvider { readonly id: string; dailyRates(currencies: readonly string[], from: string): Promise<FxDailyRate[]> }
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>
```
- `toYahooSymbol(ref)`, `fromYahooSymbol(symbol, exchangeCode): ListingRef | null`, `createYahooProvider(fetch?: FetchLike): MarketDataProvider`.

- [ ] **Step 1: Package files** — `packages/market-data/package.json`:
```json
{
  "name": "@pv/market-data",
  "version": "0.1.0",
  "private": true,
  "license": "AGPL-3.0-only",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": { "@pv/core": "*" }
}
```
`packages/market-data/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`. Add `"packages/market-data"` to the root `workspaces` (after `packages/db`), run `npm install`.

- [ ] **Step 2: Record fixtures** (real responses, committed; the tests never go online):
```bash
cd packages/market-data/test/fixtures
UA='Mozilla/5.0'
Y=https://query1.finance.yahoo.com
curl -s -A "$UA" "$Y/v1/finance/search?q=agnico&quotesCount=10&newsCount=0" -o yahoo-search-agnico.json
curl -s -A "$UA" "$Y/v8/finance/chart/AAPL?period1=1598400000&period2=1599264000&interval=1d&events=div%2Csplit" -o yahoo-chart-aapl-split.json
curl -s -A "$UA" "$Y/v8/finance/chart/FRES.L?range=5d&interval=1d" -o yahoo-chart-fres.json
curl -s -A "$UA" "$Y/v8/finance/spark?symbols=AEM,LG.V,FRES.L&range=1d&interval=5m" -o yahoo-spark-quotes.json
curl -s -A "$UA" "$Y/v8/finance/spark?symbols=EURUSD%3DX,EURGBP%3DX&range=1d&interval=15m" -o yahoo-spark-fx.json
```
Check each file is JSON with data (not an error object).

- [ ] **Step 3: Failing tests** — `packages/market-data/test/yahoo-symbols.test.ts`
```ts
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
  it('maps Yahoo exchange codes back to MIC and bare symbol', () => {
    expect(fromYahooSymbol('AEM.TO', 'TOR')).toEqual({ mic: 'XTSE', symbol: 'AEM' })
    expect(fromYahooSymbol('LGCXF', 'PNK')).toEqual({ mic: 'OTCM', symbol: 'LGCXF' })
    expect(fromYahooSymbol('RIO.AX', 'ASX')).toEqual({ mic: 'XASX', symbol: 'RIO' })
    expect(fromYahooSymbol('XYZ.QQ', 'QQQ')).toBeNull()
  })
})
```

`packages/market-data/test/yahoo.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FetchLike } from '../src/types.ts'
import { createYahooProvider } from '../src/yahoo.ts'

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown

/** Serves recorded responses by URL fragment; any other request fails the test. */
function fakeFetch(routes: Record<string, string>): FetchLike & { calls: string[] } {
  const calls: string[] = []
  const fn = async (url: string) => {
    calls.push(url)
    const match = Object.keys(routes).find((fragment) => url.includes(fragment))
    if (!match) return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
    const body = fixture(routes[match]!)
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
  }
  return Object.assign(fn, { calls })
}

describe('Yahoo provider', () => {
  it('finds listings by name with MIC, type and sector', async () => {
    const yahoo = createYahooProvider(fakeFetch({ '/v1/finance/search': 'yahoo-search-agnico.json' }))
    const results = await yahoo.search('agnico')
    expect(results).toContainEqual(expect.objectContaining({ mic: 'XNYS', symbol: 'AEM', type: 'stock', sector: 'Basic Materials' }))
    expect(results).toContainEqual(expect.objectContaining({ mic: 'XTSE', symbol: 'AEM' }))
  })

  it('stores London prices in pence as GBX', async () => {
    const yahoo = createYahooProvider(fakeFetch({ '/v8/finance/chart/FRES.L': 'yahoo-chart-fres.json' }))
    expect(await yahoo.describe({ mic: 'XLON', symbol: 'FRES' })).toMatchObject({ currency: 'GBX', mic: 'XLON', symbol: 'FRES' })
  })

  it('returns real closes before a split (Apple 4:1 on 2020-08-31)', async () => {
    const yahoo = createYahooProvider(fakeFetch({ '/v8/finance/chart/AAPL': 'yahoo-chart-aapl-split.json' }))
    const history = await yahoo.dailyHistory({ mic: 'XNAS', symbol: 'AAPL' }, '2020-08-26')
    const close = (date: string) => history.bars.find((b) => b.date === date)?.close
    expect(close('2020-08-28')).toBeCloseTo(499.24, 1)
    expect(close('2020-08-31')).toBeCloseTo(129.04, 1)
    expect(history.splits).toEqual([{ date: '2020-08-31', ratio: 4 }])
  })

  it('reads latest prices for several listings in one request', async () => {
    const fetch = fakeFetch({ '/v8/finance/spark': 'yahoo-spark-quotes.json' })
    const yahoo = createYahooProvider(fetch)
    const quotes = await yahoo.quotes([
      { mic: 'XNYS', symbol: 'AEM' },
      { mic: 'XTSX', symbol: 'LG' },
      { mic: 'XLON', symbol: 'FRES' },
    ])
    expect(fetch.calls).toHaveLength(1)
    const lahontan = quotes.find((q) => q.ref.symbol === 'LG')!
    expect(lahontan.ref.mic).toBe('XTSX')
    expect(lahontan.price).toBeGreaterThan(0)
    expect(lahontan.previousClose).toBeGreaterThan(0)
    expect(lahontan.points.length).toBeGreaterThan(0)
  })

  it('skips symbols the provider does not answer for', async () => {
    const yahoo = createYahooProvider(fakeFetch({ '/v8/finance/spark': 'yahoo-spark-quotes.json' }))
    const quotes = await yahoo.quotes([{ mic: 'XNYS', symbol: 'AEM' }, { mic: 'XNYS', symbol: 'NOPE' }])
    expect(quotes.map((q) => q.ref.symbol)).toEqual(['AEM'])
  })

  it('reads intraday exchange rates per euro', async () => {
    const yahoo = createYahooProvider(fakeFetch({ '/v8/finance/spark': 'yahoo-spark-fx.json' }))
    const rates = await yahoo.fxLatest(['USD', 'GBP'])
    expect(rates.map((r) => r.currency).sort()).toEqual(['GBP', 'USD'])
    expect(rates.find((r) => r.currency === 'USD')!.perEur).toBeGreaterThan(0.5)
  })
})
```

- [ ] **Step 4: Run to see them fail** — `npm test -w @pv/market-data` → FAIL (modules missing).

- [ ] **Step 5: Implement**

`packages/market-data/src/types.ts`: exactly the interfaces listed under **Produces** above, with `import type { InstrumentType } from '@pv/core'`.

`packages/market-data/src/http.ts`:
```ts
import type { FetchLike } from './types.ts'

export class ProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderError'
  }
}

const defaultFetch: FetchLike = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })

/** GET a JSON document; one retry after a short pause on rate limiting or server errors. */
export async function getJson(url: string, fetchImpl: FetchLike = defaultFetch, headers: Record<string, string> = {}): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(url, { headers })
    if (response.ok) return response.json()
    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt >= 1) throw new ProviderError(`GET ${url} failed with HTTP ${response.status}`)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
}

export async function getText(url: string, fetchImpl: FetchLike = defaultFetch): Promise<string> {
  const response = await fetchImpl(url)
  if (!response.ok) throw new ProviderError(`GET ${url} failed with HTTP ${response.status}`)
  return response.text()
}

export { defaultFetch }
```

`packages/market-data/src/yahoo-symbols.ts`:
```ts
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

export function toYahooSymbol(ref: ListingRef): string {
  return `${ref.symbol}${MIC_TO_SUFFIX[ref.mic] ?? ''}`
}

export function fromYahooSymbol(symbol: string, exchangeCode: string): ListingRef | null {
  const mic = EXCHANGE_TO_MIC[exchangeCode]
  if (!mic) return null
  const suffix = MIC_TO_SUFFIX[mic] ?? ''
  return { mic, symbol: suffix && symbol.endsWith(suffix) ? symbol.slice(0, -suffix.length) : symbol }
}
```

`packages/market-data/src/yahoo.ts`:
```ts
import { normalizeCurrencyCode, todayInTimeZone, type InstrumentType } from '@pv/core'
import { defaultFetch, getJson } from './http.ts'
import type { DailyHistory, FetchLike, FxQuote, ListingCandidate, ListingDetails, ListingRef, MarketDataProvider, Quote } from './types.ts'
import { fromYahooSymbol, toYahooSymbol } from './yahoo-symbols.ts'

const BASE = 'https://query1.finance.yahoo.com'
const HEADERS = { 'User-Agent': 'Mozilla/5.0' }
const SPARK_BATCH = 20

interface SearchResponse {
  quotes?: { symbol: string; exchange: string; quoteType: string; shortname?: string; longname?: string; exchDisp?: string; sector?: string }[]
}
interface ChartResponse {
  chart: {
    result: {
      meta: { currency: string; symbol: string; exchangeName: string; instrumentType: string; longName?: string; shortName?: string; exchangeTimezoneName: string }
      timestamp?: number[]
      events?: { splits?: Record<string, { date: number; numerator: number; denominator: number }>; dividends?: Record<string, { date: number; amount: number }> }
      indicators: { quote: { close: (number | null)[] }[] }
    }[] | null
  }
}
type SparkResponse = Record<string, { timestamp?: number[]; close?: (number | null)[]; previousClose?: number | null; chartPreviousClose?: number | null }>

const TYPES: Record<string, InstrumentType> = { EQUITY: 'stock', ETF: 'etf', MUTUALFUND: 'fund', INDEX: 'index' }

function epochSeconds(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000)
}

export function createYahooProvider(fetchImpl: FetchLike = defaultFetch): MarketDataProvider {
  const get = (path: string) => getJson(`${BASE}${path}`, fetchImpl, HEADERS)

  async function chart(ref: ListingRef, query: string) {
    const body = (await get(`/v8/finance/chart/${encodeURIComponent(toYahooSymbol(ref))}?${query}`)) as ChartResponse
    return body.chart.result?.[0] ?? null
  }

  async function spark(symbols: string[], interval: string): Promise<SparkResponse> {
    const result: SparkResponse = {}
    for (let i = 0; i < symbols.length; i += SPARK_BATCH) {
      const batch = symbols.slice(i, i + SPARK_BATCH)
      const body = (await get(`/v8/finance/spark?symbols=${batch.map(encodeURIComponent).join(',')}&range=1d&interval=${interval}`)) as SparkResponse
      Object.assign(result, body)
    }
    return result
  }

  function lastPoint(entry: SparkResponse[string]): { price: number; ts: Date; points: { ts: Date; price: number }[] } | null {
    const points = (entry.timestamp ?? [])
      .map((t, i) => ({ ts: new Date(t * 1000), price: entry.close?.[i] ?? null }))
      .filter((p): p is { ts: Date; price: number } => p.price !== null && Number.isFinite(p.price))
    const last = points.at(-1)
    return last ? { price: last.price, ts: last.ts, points } : null
  }

  return {
    id: 'yahoo',

    async search(query) {
      const body = (await get(`/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`)) as SearchResponse
      const candidates: ListingCandidate[] = []
      for (const q of body.quotes ?? []) {
        const type = TYPES[q.quoteType]
        const ref = fromYahooSymbol(q.symbol, q.exchange)
        if (!type || !ref) continue
        candidates.push({ ...ref, name: q.longname ?? q.shortname ?? q.symbol, type, exchangeName: q.exchDisp ?? q.exchange, sector: q.sector ?? null })
      }
      return candidates
    },

    async describe(ref) {
      const result = await chart(ref, 'range=5d&interval=1d')
      if (!result) return null
      const details: ListingDetails = {
        ...ref,
        name: result.meta.longName ?? result.meta.shortName ?? ref.symbol,
        currency: normalizeCurrencyCode(result.meta.currency),
        type: TYPES[result.meta.instrumentType] ?? 'other',
      }
      return details
    },

    async quotes(refs) {
      const bySymbol = new Map(refs.map((ref) => [toYahooSymbol(ref), ref]))
      const body = await spark([...bySymbol.keys()], '5m')
      const quotes: Quote[] = []
      for (const [symbol, ref] of bySymbol) {
        const entry = body[symbol]
        const last = entry ? lastPoint(entry) : null
        if (!entry || !last) continue
        quotes.push({ ref, price: last.price, previousClose: entry.previousClose ?? entry.chartPreviousClose ?? null, asOf: last.ts, points: last.points })
      }
      return quotes
    },

    async dailyHistory(ref, from) {
      const now = Math.floor(Date.now() / 1000)
      const result = await chart(ref, `period1=${epochSeconds(from)}&period2=${now}&interval=1d&events=div%2Csplit`)
      const empty: DailyHistory = { bars: [], dividends: [], splits: [] }
      if (!result) return empty
      const tz = result.meta.exchangeTimezoneName
      const localDate = (seconds: number) => todayInTimeZone(tz, new Date(seconds * 1000))
      const splits = Object.values(result.events?.splits ?? {})
        .map((s) => ({ date: localDate(s.date), ratio: s.numerator / s.denominator }))
        .sort((a, b) => a.date.localeCompare(b.date))
      // Yahoo divides closes before a split by its ratio; multiply back to get the real close of that day.
      const factorAfter = (date: string) => splits.filter((s) => s.date > date).reduce((f, s) => f * s.ratio, 1)
      const closes = result.indicators.quote[0]?.close ?? []
      const byDate = new Map<string, number>()
      ;(result.timestamp ?? []).forEach((t, i) => {
        const close = closes[i]
        if (close === null || close === undefined || !Number.isFinite(close)) return
        const date = localDate(t)
        byDate.set(date, close * factorAfter(date))
      })
      const dividends = Object.values(result.events?.dividends ?? {}).map((d) => {
        const exDate = localDate(d.date)
        return { exDate, amount: d.amount * factorAfter(exDate) }
      })
      return { bars: [...byDate].map(([date, close]) => ({ date, close })), dividends, splits }
    },

    async fxLatest(currencies) {
      const symbols = currencies.filter((c) => c !== 'EUR').map((c) => `EUR${c}=X`)
      if (symbols.length === 0) return []
      const body = await spark(symbols, '15m')
      const rates: FxQuote[] = []
      for (const currency of currencies) {
        const entry = body[`EUR${currency}=X`]
        const last = entry ? lastPoint(entry) : null
        if (last) rates.push({ currency, perEur: last.price, asOf: last.ts })
      }
      return rates
    },
  }
}
```

`packages/market-data/src/index.ts`:
```ts
export * from './http.ts'
export * from './types.ts'
export * from './yahoo-symbols.ts'
export * from './yahoo.ts'
```

- [ ] **Step 6: Verify** — `npm test -w @pv/market-data` → PASS; `npm run typecheck -w @pv/market-data` → exit 0.

- [ ] **Step 7: Commit** — `git commit -m "feat(market-data): provider interface and Yahoo adapter with unadjusted closes" -- package.json package-lock.json packages/market-data`

---

### Task 4: ECB reference rates

**Files:**
- Create: `packages/market-data/src/ecb.ts`, `packages/market-data/test/fixtures/ecb-usd-gbp.csv`
- Modify: `packages/market-data/src/index.ts`
- Test: `packages/market-data/test/ecb.test.ts`

**Interfaces:**
- Produces: `createEcbProvider(fetch?: FetchLike): FxHistoryProvider` (`dailyRates(currencies, from)`), `parseEcbCsv(text): FxDailyRate[]`.

- [ ] **Step 1: Record the fixture**
```bash
curl -s "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP.EUR.SP00.A?format=csvdata&detail=dataonly&startPeriod=2026-09-21&endPeriod=2026-09-25" -o packages/market-data/test/fixtures/ecb-usd-gbp.csv
```

- [ ] **Step 2: Failing test** — `packages/market-data/test/ecb.test.ts`
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createEcbProvider, parseEcbCsv } from '../src/ecb.ts'

const csv = readFileSync(new URL('./fixtures/ecb-usd-gbp.csv', import.meta.url), 'utf8')

describe('ECB reference rates', () => {
  it('parses one rate per currency and day', () => {
    const rows = parseEcbCsv(csv)
    expect(rows).toContainEqual({ currency: 'USD', date: '2026-09-25', perEur: 1.1403 })
    expect(rows).toContainEqual({ currency: 'GBP', date: '2026-09-25', perEur: 0.86045 })
    expect(new Set(rows.map((r) => r.currency))).toEqual(new Set(['USD', 'GBP']))
  })

  it('asks only for currencies the ECB publishes and never for the euro', async () => {
    const urls: string[] = []
    const ecb = createEcbProvider(async (url) => {
      urls.push(url)
      return { ok: true, status: 200, json: async () => ({}), text: async () => csv }
    })
    await ecb.dailyRates(['USD', 'EUR', 'GBP'], '2026-09-21')
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('D.USD+GBP.EUR.SP00.A')
    expect(urls[0]).toContain('startPeriod=2026-09-21')
    expect(await ecb.dailyRates(['EUR'], '2026-09-21')).toEqual([])
  })
})
```

- [ ] **Step 3: Run to see it fail** — `npm test -w @pv/market-data` → FAIL.

- [ ] **Step 4: Implement** — `packages/market-data/src/ecb.ts`
```ts
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

export function createEcbProvider(fetchImpl: FetchLike = defaultFetch): FxHistoryProvider {
  return {
    id: 'ecb',
    async dailyRates(currencies, from) {
      const codes = [...new Set(currencies.filter((c) => c !== 'EUR'))]
      if (codes.length === 0) return []
      const url = `${BASE}/D.${codes.join('+')}.EUR.SP00.A?format=csvdata&detail=dataonly&startPeriod=${from}`
      return parseEcbCsv(await getText(url, fetchImpl))
    },
  }
}
```
Add `export * from './ecb.ts'` to `src/index.ts`.

- [ ] **Step 5: Verify** — `npm test -w @pv/market-data` → PASS; typecheck exit 0.

- [ ] **Step 6: Commit** — `git commit -m "feat(market-data): ECB daily reference rates" -- packages/market-data`

---

### Task 5: Market tables and repositories

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/src/index.ts`, `packages/db/test/helpers.ts`
- Create: `packages/db/src/market.ts`, `packages/db/src/jobs.ts`, `packages/db/migrations/0002_*.sql` (generated)
- Test: `packages/db/test/market.test.ts`, `packages/db/test/jobs.test.ts`

**Interfaces:**
- Consumes: `toMajorUnit` (core).
- Produces:
  - tables `quotes`, `dailyPrices`, `intradayPrices`, `fxLatest`, `referenceDividends`, `referenceSplits`, `jobStatus`
  - `interface ListingInUse { id: string; mic: string; symbol: string; currency: string }`
  - `listingsInUse(db): Promise<ListingInUse[]>`, `listingsWithoutHistory(db): Promise<ListingInUse[]>`
  - `currenciesInUse(db): Promise<string[]>` (major units, sorted, no EUR), `currenciesWithoutFxHistory(db, currencies): Promise<string[]>`
  - `saveQuotes(db, rows: { listingId; price; previousClose; asOf; source; points: { ts; price }[] }[])`, `purgeIntraday(db, before: Date)`
  - `saveDailyHistory(db, listingId, history: { bars; dividends; splits }, source)`
  - `saveFxRates(db, rows: { currency; date; perEur }[])`, `saveFxLatest(db, rows: { currency; perEur; asOf; source }[])`
  - `runJob<T>(db, job: string, fn: () => Promise<T>): Promise<T | undefined>` (records `job_status`; returns undefined on error, never throws)

- [ ] **Step 1: Schema** — append to `packages/db/src/schema.ts`:
```ts
export const quotes = pgTable('quotes', {
  listingId: uuid('listing_id').primaryKey().references(() => listings.id, { onDelete: 'cascade' }),
  price: amount('price').notNull(),
  previousClose: amount('previous_close'),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  source: text('source').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Real (unadjusted) closes in the listing currency. */
export const dailyPrices = pgTable(
  'daily_prices',
  {
    listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    close: amount('close').notNull(),
    source: text('source').notNull(),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.date] })],
)

export const intradayPrices = pgTable(
  'intraday_prices',
  {
    listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    price: amount('price').notNull(),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.ts] })],
)

export const fxLatest = pgTable('fx_latest', {
  currency: char('currency', { length: 3 }).primaryKey(),
  perEur: amount('per_eur').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  source: text('source').notNull(),
})

export const referenceDividends = pgTable(
  'reference_dividends',
  {
    listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
    exDate: date('ex_date', { mode: 'string' }).notNull(),
    amount: amount('amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.exDate] })],
)

export const referenceSplits = pgTable(
  'reference_splits',
  {
    listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    ratio: amount('ratio').notNull(),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.date] })],
)

export const jobStatus = pgTable('job_status', {
  job: text('job').primaryKey(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
})
```
Then `npm run generate -w @pv/db` → `migrations/0002_*.sql` with seven `CREATE TABLE`s. Extend the truncate list in `test/helpers.ts` with `quotes, daily_prices, intraday_prices, fx_latest, reference_dividends, reference_splits, job_status`.

- [ ] **Step 2: Failing tests** — `packages/db/test/market.test.ts`
```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { upsertListing } from '../src/instruments.ts'
import {
  currenciesInUse, currenciesWithoutFxHistory, listingsInUse, listingsWithoutHistory, purgeIntraday, saveDailyHistory, saveFxLatest, saveFxRates, saveQuotes,
} from '../src/market.ts'
import { archivePortfolio, createPortfolio } from '../src/portfolios.ts'
import { dailyPrices, fxLatest, intradayPrices, quotes, referenceDividends, referenceSplits } from '../src/schema.ts'
import { createTransaction } from '../src/transactions.ts'
import { makeMember, useTestDb } from './helpers.ts'

const { db } = useTestDb()

async function holding(email: string, listing: { mic: string; symbol: string; currency: string }, baseCurrency = 'EUR') {
  const member = await makeMember(db, email, { baseCurrency })
  const portfolio = await createPortfolio(db, member.id, { name: 'Main' })
  const { instrumentId, listingId } = await upsertListing(db, { name: listing.symbol, ...listing })
  await createTransaction(db, member.id, {
    portfolioId: portfolio.id, instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: listing.currency, quantity: 1, price: 1, fxRate: 1,
  })
  return { member, portfolio, listingId }
}

describe('market repositories', () => {
  it('lists the listings of securities held in active portfolios only', async () => {
    const aem = await holding('a@example.com', { mic: 'XNYS', symbol: 'AEM', currency: 'USD' })
    const fres = await holding('b@example.com', { mic: 'XLON', symbol: 'FRES', currency: 'GBX' })
    await upsertListing(db, { name: 'Unused', mic: 'XETR', symbol: 'UNU', currency: 'EUR' })
    await archivePortfolio(db, fres.member.id, fres.portfolio.id)
    expect((await listingsInUse(db)).map((l) => l.id)).toEqual([aem.listingId])
  })

  it('collects the currencies in use as major units, without the euro, including base currencies', async () => {
    await holding('a@example.com', { mic: 'XNYS', symbol: 'AEM', currency: 'USD' }, 'CHF')
    await holding('b@example.com', { mic: 'XLON', symbol: 'FRES', currency: 'GBX' })
    await holding('c@example.com', { mic: 'XETR', symbol: 'SAP', currency: 'EUR' })
    expect(await currenciesInUse(db)).toEqual(['CHF', 'GBP', 'USD'])
  })

  it('stores latest quotes with their intraday points and purges old points', async () => {
    const { listingId } = await holding('a@example.com', { mic: 'XNYS', symbol: 'AEM', currency: 'USD' })
    const asOf = new Date('2026-09-28T15:00:00Z')
    const old = new Date('2026-09-10T15:00:00Z')
    await saveQuotes(db, [{ listingId, price: 101, previousClose: 100, asOf, source: 'test', points: [{ ts: old, price: 99 }, { ts: asOf, price: 101 }] }])
    await saveQuotes(db, [{ listingId, price: 102, previousClose: 100, asOf, source: 'test', points: [{ ts: asOf, price: 102 }] }])
    expect((await db.select().from(quotes))[0]).toMatchObject({ price: 102, previousClose: 100 })
    await purgeIntraday(db, new Date('2026-09-21T00:00:00Z'))
    expect(await db.select().from(intradayPrices)).toHaveLength(1)
  })

  it('stores daily history, dividends and splits and overwrites corrected closes', async () => {
    const { listingId } = await holding('a@example.com', { mic: 'XNAS', symbol: 'AAPL', currency: 'USD' })
    expect((await listingsWithoutHistory(db)).map((l) => l.id)).toEqual([listingId])
    await saveDailyHistory(db, listingId, { bars: [{ date: '2020-08-28', close: 499 }], dividends: [{ exDate: '2020-08-07', amount: 0.82 }], splits: [{ date: '2020-08-31', ratio: 4 }] }, 'test')
    await saveDailyHistory(db, listingId, { bars: [{ date: '2020-08-28', close: 499.23 }], dividends: [], splits: [] }, 'test')
    expect(await db.select().from(dailyPrices).where(eq(dailyPrices.listingId, listingId))).toEqual([{ listingId, date: '2020-08-28', close: 499.23, source: 'test' }])
    expect(await db.select().from(referenceDividends)).toHaveLength(1)
    expect(await db.select().from(referenceSplits)).toHaveLength(1)
    expect(await listingsWithoutHistory(db)).toEqual([])
  })

  it('stores exchange rates and reports currencies without history', async () => {
    await saveFxRates(db, [{ currency: 'USD', date: '2026-09-25', perEur: 1.1403 }])
    await saveFxRates(db, [{ currency: 'USD', date: '2026-09-25', perEur: 1.1404 }])
    await saveFxLatest(db, [{ currency: 'USD', perEur: 1.1392, asOf: new Date(), source: 'test' }])
    expect(await currenciesWithoutFxHistory(db, ['USD', 'GBP'])).toEqual(['GBP'])
    expect((await db.select().from(fxLatest))[0]).toMatchObject({ currency: 'USD', perEur: 1.1392 })
  })
})
```

`packages/db/test/jobs.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { runJob } from '../src/jobs.ts'
import { jobStatus } from '../src/schema.ts'
import { useTestDb } from './helpers.ts'

const { db } = useTestDb()

describe('runJob', () => {
  it('records a successful run and returns its result', async () => {
    expect(await runJob(db, 'quotes', async () => 3)).toBe(3)
    const [row] = await db.select().from(jobStatus)
    expect(row).toMatchObject({ job: 'quotes', lastError: null })
    expect(row!.lastSuccessAt).not.toBeNull()
  })

  it('records a failure without throwing', async () => {
    expect(await runJob(db, 'history', async () => { throw new Error('provider down') })).toBeUndefined()
    const [row] = await db.select().from(jobStatus)
    expect(row).toMatchObject({ job: 'history', lastError: 'provider down', lastSuccessAt: null })
  })
})
```

- [ ] **Step 3: Run to see them fail** — `npm test -w @pv/db` → FAIL (modules missing).

- [ ] **Step 4: Implement** — `packages/db/src/market.ts`
```ts
import { toMajorUnit } from '@pv/core'
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import {
  dailyPrices, fxLatest, fxRates, instruments, intradayPrices, listings, members, portfolios, quotes, referenceDividends, referenceSplits, transactions,
} from './schema.ts'

export interface ListingInUse {
  id: string
  mic: string
  symbol: string
  currency: string
}

/** Listings needed for valuation: the listing of every transaction (or its instrument's default) in active portfolios. */
export async function listingsInUse(db: Db): Promise<ListingInUse[]> {
  const used = db
    .selectDistinct({ id: sql<string>`coalesce(${transactions.listingId}, ${instruments.defaultListingId})`.as('id') })
    .from(transactions)
    .innerJoin(instruments, eq(instruments.id, transactions.instrumentId))
    .innerJoin(portfolios, eq(portfolios.id, transactions.portfolioId))
    .where(isNull(portfolios.archivedAt))
    .as('used')
  return db
    .select({ id: listings.id, mic: listings.mic, symbol: listings.symbol, currency: listings.currency })
    .from(listings)
    .innerJoin(used, eq(used.id, listings.id))
    .orderBy(asc(listings.mic), asc(listings.symbol))
}

export async function listingsWithoutHistory(db: Db): Promise<ListingInUse[]> {
  const inUse = await listingsInUse(db)
  if (inUse.length === 0) return []
  const withHistory = await db
    .selectDistinct({ id: dailyPrices.listingId })
    .from(dailyPrices)
    .where(inArray(dailyPrices.listingId, inUse.map((l) => l.id)))
  const known = new Set(withHistory.map((r) => r.id))
  return inUse.filter((l) => !known.has(l.id))
}

/** Currencies to convert: listing currencies (major units) and members' base currencies, without EUR. */
export async function currenciesInUse(db: Db): Promise<string[]> {
  const codes = new Set<string>()
  for (const l of await listingsInUse(db)) codes.add(toMajorUnit(l.currency, 1).currency)
  for (const m of await db.selectDistinct({ c: members.baseCurrency }).from(members)) codes.add(m.c)
  codes.delete('EUR')
  return [...codes].sort()
}

export async function currenciesWithoutFxHistory(db: Db, currencies: readonly string[]): Promise<string[]> {
  if (currencies.length === 0) return []
  const rows = await db.selectDistinct({ c: fxRates.currency }).from(fxRates).where(inArray(fxRates.currency, [...currencies]))
  const known = new Set(rows.map((r) => r.c))
  return currencies.filter((c) => !known.has(c))
}

export interface QuoteRow {
  listingId: string
  price: number
  previousClose: number | null
  asOf: Date
  source: string
  points: { ts: Date; price: number }[]
}

export async function saveQuotes(db: Db, rows: readonly QuoteRow[]): Promise<void> {
  for (const row of rows) {
    await db
      .insert(quotes)
      .values({ listingId: row.listingId, price: row.price, previousClose: row.previousClose, asOf: row.asOf, source: row.source })
      .onConflictDoUpdate({
        target: quotes.listingId,
        set: { price: row.price, previousClose: row.previousClose, asOf: row.asOf, source: row.source, updatedAt: new Date() },
      })
    if (row.points.length > 0) {
      await db
        .insert(intradayPrices)
        .values(row.points.map((p) => ({ listingId: row.listingId, ts: p.ts, price: p.price })))
        .onConflictDoUpdate({ target: [intradayPrices.listingId, intradayPrices.ts], set: { price: sql`excluded.price` } })
    }
  }
}

export async function purgeIntraday(db: Db, before: Date): Promise<void> {
  await db.delete(intradayPrices).where(lt(intradayPrices.ts, before))
}

export interface HistoryRows {
  bars: readonly { date: string; close: number }[]
  dividends: readonly { exDate: string; amount: number }[]
  splits: readonly { date: string; ratio: number }[]
}

const CHUNK = 1000

export async function saveDailyHistory(db: Db, listingId: string, history: HistoryRows, source: string): Promise<void> {
  for (let i = 0; i < history.bars.length; i += CHUNK) {
    await db
      .insert(dailyPrices)
      .values(history.bars.slice(i, i + CHUNK).map((b) => ({ listingId, date: b.date, close: b.close, source })))
      .onConflictDoUpdate({ target: [dailyPrices.listingId, dailyPrices.date], set: { close: sql`excluded.close`, source: sql`excluded.source` } })
  }
  if (history.dividends.length > 0) {
    await db
      .insert(referenceDividends)
      .values(history.dividends.map((d) => ({ listingId, exDate: d.exDate, amount: d.amount })))
      .onConflictDoUpdate({ target: [referenceDividends.listingId, referenceDividends.exDate], set: { amount: sql`excluded.amount` } })
  }
  if (history.splits.length > 0) {
    await db
      .insert(referenceSplits)
      .values(history.splits.map((s) => ({ listingId, date: s.date, ratio: s.ratio })))
      .onConflictDoUpdate({ target: [referenceSplits.listingId, referenceSplits.date], set: { ratio: sql`excluded.ratio` } })
  }
}

export async function saveFxRates(db: Db, rows: readonly { currency: string; date: string; perEur: number }[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(fxRates)
      .values(rows.slice(i, i + CHUNK).map((r) => ({ ...r })))
      .onConflictDoUpdate({ target: [fxRates.currency, fxRates.date], set: { perEur: sql`excluded.per_eur` } })
  }
}

export async function saveFxLatest(db: Db, rows: readonly { currency: string; perEur: number; asOf: Date; source: string }[]): Promise<void> {
  for (const row of rows) {
    await db
      .insert(fxLatest)
      .values(row)
      .onConflictDoUpdate({ target: fxLatest.currency, set: { perEur: row.perEur, asOf: row.asOf, source: row.source } })
  }
}
```
(The first import line is `import { asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'`.)

`packages/db/src/jobs.ts`:
```ts
import { eq } from 'drizzle-orm'
import type { Db } from './client.ts'
import { jobStatus } from './schema.ts'

/** Runs a job and records its outcome in job_status. Errors are recorded, never thrown. */
export async function runJob<T>(db: Db, job: string, fn: () => Promise<T>): Promise<T | undefined> {
  const startedAt = new Date()
  await db.insert(jobStatus).values({ job, lastRunAt: startedAt }).onConflictDoUpdate({ target: jobStatus.job, set: { lastRunAt: startedAt } })
  try {
    const result = await fn()
    await db.update(jobStatus).set({ lastSuccessAt: new Date(), lastError: null }).where(eq(jobStatus.job, job))
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.update(jobStatus).set({ lastError: message.slice(0, 1000), lastErrorAt: new Date() }).where(eq(jobStatus.job, job))
    return undefined
  }
}
```

Add to `packages/db/src/index.ts`: `export * from './jobs.ts'` and `export * from './market.ts'`.

- [ ] **Step 5: Verify** — `npm test -w @pv/db` → PASS; `npm run typecheck -w @pv/db` → exit 0.

- [ ] **Step 6: Commit** — `git commit -m "feat(db): market tables and repositories for quotes, history, rates and job status" -- packages/db`

---

### Task 6: Worker jobs

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/vitest.config.ts`, `apps/worker/src/jobs.ts`
- Modify: root `package.json` (workspace `apps/worker`)
- Test: `apps/worker/test/fake-provider.ts`, `apps/worker/test/jobs.test.ts`

**Interfaces:**
- Consumes: Task 3/4 provider types; Task 5 repositories; `isExchangeOpen`, `addDays`, `todayInTimeZone`, `addMonths` (core).
- Produces:
```ts
export interface JobContext { db: Db; provider: MarketDataProvider; fxHistory: FxHistoryProvider; now: () => Date; log: (message: string) => void }
export function refreshQuotes(ctx): Promise<number>        // listings refreshed
export function refreshFxLatest(ctx): Promise<number>
export function refreshFxDaily(ctx, days?: number): Promise<number>
export function backfill(ctx, years?: number): Promise<{ listings: number; currencies: number }>
export function refreshHistory(ctx, days?: number): Promise<number>
```

- [ ] **Step 1: Package files** — `apps/worker/package.json`:
```json
{
  "name": "@pv/worker",
  "version": "0.1.0",
  "private": true,
  "license": "AGPL-3.0-only",
  "type": "module",
  "scripts": {
    "start": "node src/main.ts",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@pv/core": "*",
    "@pv/db": "*",
    "@pv/market-data": "*",
    "croner": "^10.0.1",
    "drizzle-orm": "^0.45.3"
  }
}
```
`apps/worker/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "vitest.config.ts"] }`
`apps/worker/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['../../packages/db/test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    include: ['test/**/*.test.ts'],
  },
})
```
Add `"apps/worker"` to the root workspaces; `npm install`.

- [ ] **Step 2: Fake provider** — `apps/worker/test/fake-provider.ts`
```ts
import type { DailyHistory, FxHistoryProvider, ListingRef, MarketDataProvider, Quote } from '@pv/market-data'

/** A provider that answers from memory and records every call. */
export function fakeProvider(options: { failSymbols?: string[] } = {}) {
  const calls = { quotes: [] as ListingRef[][], history: [] as { ref: ListingRef; from: string }[], fxLatest: [] as string[][] }
  const provider: MarketDataProvider = {
    id: 'fake',
    search: async () => [],
    describe: async () => null,
    async quotes(refs) {
      calls.quotes.push([...refs])
      return refs
        .filter((ref) => !options.failSymbols?.includes(ref.symbol))
        .map((ref): Quote => ({ ref, price: 101, previousClose: 100, asOf: new Date('2026-09-28T15:00:00Z'), points: [{ ts: new Date('2026-09-28T15:00:00Z'), price: 101 }] }))
    },
    async dailyHistory(ref, from): Promise<DailyHistory> {
      calls.history.push({ ref, from })
      if (options.failSymbols?.includes(ref.symbol)) throw new Error(`no data for ${ref.symbol}`)
      return { bars: [{ date: '2026-09-25', close: 100 }, { date: '2026-09-28', close: 101 }], dividends: [], splits: [] }
    },
    async fxLatest(currencies) {
      calls.fxLatest.push([...currencies])
      return currencies.map((currency) => ({ currency, perEur: 1.1, asOf: new Date('2026-09-28T15:00:00Z') }))
    },
  }
  const fxCalls: { currencies: string[]; from: string }[] = []
  const fxHistory: FxHistoryProvider = {
    id: 'fake-fx',
    async dailyRates(currencies, from) {
      fxCalls.push({ currencies: [...currencies], from })
      return currencies.map((currency) => ({ currency, date: '2026-09-25', perEur: 1.1 }))
    },
  }
  return { provider, fxHistory, calls, fxCalls }
}
```

- [ ] **Step 3: Failing tests** — `apps/worker/test/jobs.test.ts`
```ts
import { createDb, createPortfolio, createTransaction, dailyPrices, fxLatest, fxRates, members, quotes, upsertListing } from '@pv/db'
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { backfill, refreshFxDaily, refreshFxLatest, refreshHistory, refreshQuotes, type JobContext } from '../src/jobs.ts'
import { fakeProvider } from './fake-provider.ts'

const { db, sql } = createDb(inject('databaseUrl'))
afterAll(async () => { await sql.end() })
beforeEach(async () => {
  await sql`truncate members, portfolios, instruments, listings, transactions, fx_rates, quotes, daily_prices, intraday_prices, fx_latest, reference_dividends, reference_splits, job_status restart identity cascade`
})

const MONDAY_NY_MORNING = new Date('2026-09-28T15:00:00Z') // 11:00 New York, 01:00 Sydney next day

async function hold(listings: { mic: string; symbol: string; currency: string }[]) {
  const [member] = await db.insert(members).values({ email: 'owner@example.com', status: 'active' }).returning()
  const portfolio = await createPortfolio(db, member!.id, { name: 'Main' })
  for (const l of listings) {
    const { instrumentId } = await upsertListing(db, { name: l.symbol, ...l })
    await createTransaction(db, member!.id, { portfolioId: portfolio.id, instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: l.currency, quantity: 1, price: 1, fxRate: 1 })
  }
}

function context(fake: ReturnType<typeof fakeProvider>, now = MONDAY_NY_MORNING): JobContext {
  return { db, provider: fake.provider, fxHistory: fake.fxHistory, now: () => now, log: () => {} }
}

describe('worker jobs', () => {
  it('polls only listings whose exchange is open', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }, { mic: 'XASX', symbol: 'RIO', currency: 'AUD' }])
    const fake = fakeProvider()
    expect(await refreshQuotes(context(fake))).toBe(1)
    expect(fake.calls.quotes.flat().map((r) => r.symbol)).toEqual(['AEM'])
    expect(await db.select().from(quotes)).toHaveLength(1)
  })

  it('polls nothing on a weekend', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }])
    const fake = fakeProvider()
    expect(await refreshQuotes(context(fake, new Date('2026-09-26T15:00:00Z')))).toBe(0)
    expect(fake.calls.quotes).toEqual([])
  })

  it('keeps the quotes of the other listings when one symbol has no answer', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }, { mic: 'XNYS', symbol: 'GONE', currency: 'USD' }])
    const fake = fakeProvider({ failSymbols: ['GONE'] })
    expect(await refreshQuotes(context(fake))).toBe(1)
  })

  it('backfills ten years once per listing and continues past a failing listing', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }, { mic: 'XNYS', symbol: 'GONE', currency: 'USD' }])
    const fake = fakeProvider({ failSymbols: ['GONE'] })
    const first = await backfill(context(fake))
    expect(first).toEqual({ listings: 1, currencies: 1 })
    expect(fake.calls.history.find((c) => c.ref.symbol === 'AEM')!.from).toBe('2016-09-28')
    expect(await db.select().from(dailyPrices)).toHaveLength(2)
    expect(fake.fxCalls).toEqual([{ currencies: ['USD'], from: '2016-09-28' }])
    await backfill(context(fake))
    expect(fake.calls.history.filter((c) => c.ref.symbol === 'AEM')).toHaveLength(1)
    expect(fake.fxCalls).toHaveLength(1)
  })

  it('refreshes the last days of history for every listing in use', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }])
    const fake = fakeProvider()
    expect(await refreshHistory(context(fake))).toBe(1)
    expect(fake.calls.history[0]!.from).toBe('2026-09-18')
  })

  it('stores intraday and daily exchange rates for the currencies in use', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }, { mic: 'XLON', symbol: 'FRES', currency: 'GBX' }])
    const fake = fakeProvider()
    expect(await refreshFxLatest(context(fake))).toBe(2)
    expect(fake.calls.fxLatest).toEqual([['GBP', 'USD']])
    expect(await db.select().from(fxLatest)).toHaveLength(2)
    expect(await refreshFxDaily(context(fake))).toBe(2)
    expect(fake.fxCalls[0]).toEqual({ currencies: ['GBP', 'USD'], from: '2026-09-18' })
    expect(await db.select().from(fxRates)).toHaveLength(2)
  })
})
```

- [ ] **Step 4: Run to see it fail** — `npm test -w @pv/worker` → FAIL (`../src/jobs.ts` missing).

- [ ] **Step 5: Implement** — `apps/worker/src/jobs.ts`
```ts
import { addDays, addMonths, isExchangeOpen, todayInTimeZone } from '@pv/core'
import {
  currenciesInUse, currenciesWithoutFxHistory, listingsInUse, listingsWithoutHistory, purgeIntraday, saveDailyHistory, saveFxLatest, saveFxRates, saveQuotes,
  type Db, type ListingInUse,
} from '@pv/db'
import type { FxHistoryProvider, MarketDataProvider } from '@pv/market-data'

export interface JobContext {
  db: Db
  provider: MarketDataProvider
  fxHistory: FxHistoryProvider
  now: () => Date
  log: (message: string) => void
}

const INTRADAY_KEEP_DAYS = 7
const today = (ctx: JobContext) => todayInTimeZone('UTC', ctx.now())
const refOf = (l: ListingInUse) => ({ mic: l.mic, symbol: l.symbol })
const key = (ref: { mic: string; symbol: string }) => `${ref.mic}:${ref.symbol}`

/** Latest prices for held listings whose exchange is open (plus a grace period after the close). */
export async function refreshQuotes(ctx: JobContext): Promise<number> {
  const open = (await listingsInUse(ctx.db)).filter((l) => isExchangeOpen(l.mic, ctx.now()))
  if (open.length > 0) {
    const byKey = new Map(open.map((l) => [key(l), l]))
    const received = await ctx.provider.quotes(open.map(refOf))
    await saveQuotes(
      ctx.db,
      received.flatMap((q) => {
        const listing = byKey.get(key(q.ref))
        return listing ? [{ listingId: listing.id, price: q.price, previousClose: q.previousClose, asOf: q.asOf, source: ctx.provider.id, points: q.points }] : []
      }),
    )
    ctx.log(`quotes: ${received.length} of ${open.length} open listings`)
    await purgeIntraday(ctx.db, new Date(ctx.now().getTime() - INTRADAY_KEEP_DAYS * 86_400_000))
    return received.length
  }
  await purgeIntraday(ctx.db, new Date(ctx.now().getTime() - INTRADAY_KEEP_DAYS * 86_400_000))
  return 0
}

export async function refreshFxLatest(ctx: JobContext): Promise<number> {
  const currencies = await currenciesInUse(ctx.db)
  if (currencies.length === 0) return 0
  const rates = await ctx.provider.fxLatest(currencies)
  await saveFxLatest(ctx.db, rates.map((r) => ({ ...r, source: ctx.provider.id })))
  return rates.length
}

export async function refreshFxDaily(ctx: JobContext, days = 10): Promise<number> {
  const currencies = await currenciesInUse(ctx.db)
  if (currencies.length === 0) return 0
  const rates = await ctx.fxHistory.dailyRates(currencies, addDays(today(ctx), -days))
  await saveFxRates(ctx.db, rates)
  return rates.length
}

/** Ten years of closes for listings without any history, and of rates for currencies without any. */
export async function backfill(ctx: JobContext, years = 10): Promise<{ listings: number; currencies: number }> {
  const from = addMonths(today(ctx), -12 * years)
  let listings = 0
  for (const listing of await listingsWithoutHistory(ctx.db)) {
    try {
      const history = await ctx.provider.dailyHistory(refOf(listing), from)
      if (history.bars.length === 0) continue
      await saveDailyHistory(ctx.db, listing.id, history, ctx.provider.id)
      listings += 1
    } catch (error) {
      ctx.log(`backfill ${key(listing)} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const missing = await currenciesWithoutFxHistory(ctx.db, await currenciesInUse(ctx.db))
  if (missing.length > 0) await saveFxRates(ctx.db, await ctx.fxHistory.dailyRates(missing, from))
  return { listings, currencies: missing.length }
}

/** Re-reads the last days of every listing in use, picking up late corrections. */
export async function refreshHistory(ctx: JobContext, days = 10): Promise<number> {
  const from = addDays(today(ctx), -days)
  let done = 0
  for (const listing of await listingsInUse(ctx.db)) {
    try {
      await saveDailyHistory(ctx.db, listing.id, await ctx.provider.dailyHistory(refOf(listing), from), ctx.provider.id)
      done += 1
    } catch (error) {
      ctx.log(`history ${key(listing)} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return done
}
```

- [ ] **Step 6: Verify** — `npm test -w @pv/worker` → PASS; `npm run typecheck -w @pv/worker` → exit 0.

- [ ] **Step 7: Commit** — `git commit -m "feat(worker): quote, history, backfill and exchange-rate jobs" -- package.json package-lock.json apps/worker`

---

### Task 7: Scheduler, container, live check

**Files:**
- Create: `apps/worker/src/main.ts`, `apps/worker/src/providers.ts`, `apps/worker/Dockerfile`, `apps/worker/test/live.test.ts`
- Modify: `deploy/docker-compose.yml`, `deploy/.env.example`, `deploy/README.md`, `.dockerignore`, `docs/STATUS.md`, `docs/PLAN.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the `worker` service in compose (`MARKET_DATA_PROVIDER=yahoo` default).

- [ ] **Step 1: Provider selection** — `apps/worker/src/providers.ts`
```ts
import { createEcbProvider, createYahooProvider, type FxHistoryProvider, type MarketDataProvider } from '@pv/market-data'

export function selectProviders(name: string | undefined): { provider: MarketDataProvider; fxHistory: FxHistoryProvider } {
  switch (name ?? 'yahoo') {
    case 'yahoo':
      return { provider: createYahooProvider(), fxHistory: createEcbProvider() }
    default:
      throw new Error(`Unknown MARKET_DATA_PROVIDER "${name}". Supported: yahoo`)
  }
}
```

- [ ] **Step 2: Scheduler** — `apps/worker/src/main.ts`
```ts
import { createDb, runJob } from '@pv/db'
import { Cron } from 'croner'
import { backfill, refreshFxDaily, refreshFxLatest, refreshHistory, refreshQuotes, type JobContext } from './jobs.ts'
import { selectProviders } from './providers.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Set DATABASE_URL')
const quoteMinutes = Number(process.env.QUOTE_INTERVAL_MINUTES ?? 5)
if (!Number.isInteger(quoteMinutes) || quoteMinutes < 1 || quoteMinutes > 60) throw new Error('QUOTE_INTERVAL_MINUTES must be 1-60')

const { db } = createDb(databaseUrl, { max: 4 })
const ctx: JobContext = {
  db,
  ...selectProviders(process.env.MARKET_DATA_PROVIDER),
  now: () => new Date(),
  log: (message) => console.log(`[worker] ${message}`),
}

const BERLIN = { timezone: 'Europe/Berlin', protect: true }
const schedule = (pattern: string, job: string, fn: () => Promise<unknown>, options: object = { protect: true }) =>
  new Cron(pattern, options, async () => {
    await runJob(db, job, fn)
  })

schedule(`*/${quoteMinutes} * * * *`, 'quotes', () => refreshQuotes(ctx))
schedule('*/15 * * * *', 'fx-latest', () => refreshFxLatest(ctx))
schedule('40 16 * * 1-5', 'fx-daily', () => refreshFxDaily(ctx), BERLIN)
schedule('* * * * *', 'backfill', () => backfill(ctx))
schedule('30 2 * * *', 'history', () => refreshHistory(ctx), BERLIN)

ctx.log(`started with provider ${ctx.provider.id}, quotes every ${quoteMinutes} min`)
await runJob(db, 'backfill', () => backfill(ctx))
await runJob(db, 'fx-daily', () => refreshFxDaily(ctx))
await runJob(db, 'quotes', () => refreshQuotes(ctx))
```
(Check croner 10's option names in `node_modules/croner/dist/*.d.ts`; if the time-zone option is called differently, use that name and ledger the ruling.)

- [ ] **Step 3: Live check (opt-in)** — `apps/worker/test/live.test.ts`
```ts
import { createEcbProvider, createYahooProvider } from '@pv/market-data'
import { describe, expect, it } from 'vitest'

// Talks to the real services. Run with: LIVE_MARKET_DATA=1 npm test -w @pv/worker -- live
describe.runIf(process.env.LIVE_MARKET_DATA === '1')('live market data', () => {
  const yahoo = createYahooProvider()

  it('finds Agnico Eagle on the NYSE', async () => {
    expect(await yahoo.search('Agnico Eagle')).toContainEqual(expect.objectContaining({ mic: 'XNYS', symbol: 'AEM' }))
  })

  it('prices the reference portfolio’s exchanges', async () => {
    const refs = [
      { mic: 'XNYS', symbol: 'AEM' }, { mic: 'OTCM', symbol: 'LGCXF' }, { mic: 'XTSX', symbol: 'LG' }, { mic: 'XTSE', symbol: 'PEY' },
      { mic: 'XLON', symbol: 'FRES' }, { mic: 'XASX', symbol: 'RIO' }, { mic: 'XETR', symbol: '4GLD' }, { mic: 'XFRA', symbol: 'AE9' },
    ]
    const quotes = await yahoo.quotes(refs)
    expect(quotes.map((q) => q.ref.symbol).sort()).toEqual(refs.map((r) => r.symbol).sort())
    expect(await yahoo.describe({ mic: 'XLON', symbol: 'FRES' })).toMatchObject({ currency: 'GBX' })
  })

  it('returns Apple’s real close before the 2020 split', async () => {
    const history = await yahoo.dailyHistory({ mic: 'XNAS', symbol: 'AAPL' }, '2020-08-20')
    expect(history.bars.find((b) => b.date === '2020-08-28')!.close).toBeCloseTo(499.24, 0)
  })

  it('reads ECB rates', async () => {
    const rates = await createEcbProvider().dailyRates(['USD', 'CAD', 'GBP', 'AUD'], '2026-09-01')
    expect(new Set(rates.map((r) => r.currency))).toEqual(new Set(['USD', 'CAD', 'GBP', 'AUD']))
  })
})
```
Run: `LIVE_MARKET_DATA=1 npm test -w @pv/worker -- live` → 4 passed. Without the variable the file is skipped.

- [ ] **Step 4: Container** — `apps/worker/Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/market-data/package.json packages/market-data/
COPY apps/worker/package.json apps/worker/
RUN npm ci --omit=dev -w @pv/worker -w @pv/db -w @pv/core -w @pv/market-data

FROM node:24-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=deps /repo/node_modules node_modules
COPY package.json tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/market-data packages/market-data
COPY apps/worker apps/worker
USER node
CMD ["node", "apps/worker/src/main.ts"]
```
Add to `.dockerignore`: `**/test` is **not** excluded (tests are harmless) — no change needed beyond what exists.

Compose — add to `deploy/docker-compose.yml` under `services`:
```yaml
  worker:
    image: ${WORKER_IMAGE:-portfolio-viewer-worker:local}
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    restart: unless-stopped
    depends_on:
      web:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@db:5432/portfolio
      MARKET_DATA_PROVIDER: ${MARKET_DATA_PROVIDER:-yahoo}
      QUOTE_INTERVAL_MINUTES: ${QUOTE_INTERVAL_MINUTES:-5}
```
`deploy/.env.example` — add:
```bash
# Price source. "yahoo" uses Yahoo Finance and the ECB, free for private use; you are responsible
# for complying with their terms. Paid providers follow.
MARKET_DATA_PROVIDER=yahoo
```
`deploy/README.md` — add a "Prices" section: the worker fetches prices every 5 minutes while an exchange is open, 10 years of history for every newly held security within a minute, ECB rates daily; the data source is set with `MARKET_DATA_PROVIDER`.

- [ ] **Step 5: Run the stack and prove data arrives**
```bash
cd deploy && docker compose down -v && docker compose up -d --build
docker compose ps                       # db, auth, web healthy; worker running
# Create an account in the browser (first account = admin) and a portfolio "Main", then:
docker compose exec -T db psql -U postgres -d portfolio <<'SQL'
insert into instruments (id, name, type) values ('11111111-1111-4111-8111-111111111111', 'Agnico Eagle Mines', 'stock');
insert into listings (id, instrument_id, mic, symbol, currency) values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'XNYS', 'AEM', 'USD');
update instruments set default_listing_id = '22222222-2222-4222-8222-222222222222' where id = '11111111-1111-4111-8111-111111111111';
insert into transactions (portfolio_id, instrument_id, type, trade_date, quantity, price, currency, fx_rate)
  select id, '11111111-1111-4111-8111-111111111111', 'buy', '2026-01-05', 10, 100, 'USD', 0.85 from portfolios limit 1;
SQL
sleep 90
docker compose exec -T db psql -U postgres -d portfolio -c "select count(*) as closes, min(date), max(date) from daily_prices" -c "select currency, count(*) from fx_rates group by currency" -c "select job, last_success_at, last_error from job_status"
```
Expected: ~2,500 closes from 2016 to today, USD rates for ten years, `backfill` and `fx-daily` succeeded (and `quotes` succeeded, with a row in `quotes` if New York is open).

- [ ] **Step 6: Docs and commit** — tick sub-project 2 in `docs/PLAN.md`; STATUS entry with the evidence (test counts, live test, row counts). Commit:
```bash
git commit -m "feat(worker): scheduler and container; compose runs the worker" -- apps/worker deploy .dockerignore docs
```
