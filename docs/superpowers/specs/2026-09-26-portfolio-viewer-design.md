# Portfolio Viewer — product design

Status: approved direction (2026-09-26). Owner: Jim Presting, JBP Capital.
Product name: **Portfolio Viewer** (by JBP Capital Software). License: **AGPL-3.0**.

## 1. Goal

Turn the maintainer's private family tracker into a product that:

1. anyone can **self-host** from an open-source repository with one `docker compose up`;
2. JBP Capital runs as a **hosted service at `portfolio.jbpcapital.de`** for the clients of its
   financial advisory, **invite-only**, with login through the existing jbpcapital.de accounts;
3. is used in the **browser** and through an **Android app** (phone and TV, Google Play);
4. replaces the Google Sheet as the input: an elegant form for securities, share counts, cost
   basis, buys, sells and dividends.

The look and the depth of the current family tracker (dashboard, projector/TV view, history,
realized gains, dividends) are the reference; they are carried over, made generic.

### Decisions already taken

| Topic | Decision |
|---|---|
| Role of jbpcapital.de | Hosted instance for advisory clients only, invite-only, subdomain `portfolio.jbpcapital.de`. Everyone else self-hosts. |
| Account structure | One login owns several portfolios ("depots"); total view plus one view per portfolio. No sharing between logins in v1. |
| Architecture | Postgres + Supabase Auth (GoTrue) + server-only data access (approach C). |
| Market data | Pluggable providers. Self-host default: free sources (operator's own responsibility). Hosted: a paid provider licensed for display to clients — choice pending (see §9). |
| Language | English base, German translation, switchable (explicit approval for German UI text in the translation file). |
| Android | Google Play (JBP Capital developer account exists). App id `de.jbpcapital.portfolioviewer`. |
| Family instance | The family's existing instance stays untouched. Migrating the family to the new product is decided later. |
| Repository | New clean repo `JBP-Capital/portfolio-viewer`, private until the open-source release. The private repo of the family tracker is never published. |

## 2. Architecture

```
            Browser / Android WebView (phone, TV)
                          │  HTTPS, cookies
                          ▼
   ┌──────────────────────────────────────────────┐
   │ web  (Next.js, App Router)                   │
   │  UI, input forms, TV mode, JSON API          │
   │  every data access goes through packages/db  │
   └───────┬───────────────────────┬──────────────┘
           │ SQL                   │ auth API (GoTrue)
           ▼                       ▼
   ┌──────────────┐        ┌──────────────────────┐
   │ Postgres     │◀───────│ auth (GoTrue)        │  self-host: own container
   │ app schema   │        │                      │  hosted: supabaseapi.jbpcapital.de
   └──────▲───────┘        └──────────────────────┘
          │ SQL
   ┌──────┴──────────────────────────┐
   │ worker (Node)                   │──▶ market data providers (Yahoo, ECB, paid)
   │ quotes, FX, history, dividends  │
   └─────────────────────────────────┘
```

- The **browser never talks to the database**. There is no anon key with table access. Every
  request is authenticated by the web server, which only calls tenant-scoped repository functions.
- **Self-host** = 4 containers: `db` (Postgres), `auth` (GoTrue), `web`, `worker`.
- **Hosted** = `web` + `worker` on JBP's Coolify, a dedicated Postgres, and the existing Supabase
  Auth of jbpcapital.de (same accounts as the jbpcapital.de "Premium" area).
- Prices are 15-minute delayed at best; the UI **polls** (60 s) instead of holding realtime
  connections. No Supabase Realtime.

### Repository layout (npm workspaces, Node 24, TypeScript)

```
apps/web            Next.js 16, Tailwind 4, next-intl
apps/worker         market-data jobs
apps/android        Kotlin WebView shell (phone + TV)
packages/core       pure domain logic: ledger, valuation, returns, currencies, exchanges
packages/db         Drizzle schema, SQL migrations, tenant-scoped repositories
packages/market-data provider interface + adapters (yahoo, ecb, paid provider)
deploy/             docker-compose.yml, .env.example, init SQL
docs/               PLAN.md, STATUS.md, specs, self-hosting guide
```

Tests: Vitest for packages and API; Playwright for web end-to-end; a real Postgres (Docker) for
repository and isolation tests.

## 3. Authentication and access

- Auth is **GoTrue** in both modes, used through `@supabase/ssr` (cookie sessions). Env:
  `AUTH_URL`, `AUTH_ANON_KEY`, `AUTH_JWT_SECRET` (or JWKS), `AUTH_SERVICE_ROLE_KEY` (invites).
- Self-host: `web` proxies `/auth/v1/*` to the `auth` container, so the browser only ever sees
  one origin. Without SMTP, e-mail confirmation is switched off (`GOTRUE_MAILER_AUTOCONFIRM`).
  From outside, the proxy forwards only `GET /verify` (the links in GoTrue's e-mails); sign-in,
  sign-up and password reset run through the app's server actions, whose calls carry a token
  derived from the auth secret. (Amended 2026-09-26 after review.)
- Sign-in is throttled: 10 failed attempts per address within 15 minutes block that address for
  the rest of the window.
- Session cookie: `httpOnly`, `SameSite=Lax`, `Secure` when `PUBLIC_URL` is HTTPS.
- **Access gate** (both modes): a login alone grants nothing. Access requires a row in `members`.
  - Hosted: an admin invites an e-mail address on `/admin`. New address → GoTrue invite e-mail
    (jbpcapital.de templates). Existing jbpcapital.de account → access is granted, the client
    logs in with the password they already have.
  - Self-host: while `members` is empty, the first account that signs up becomes admin. After that
    the instance is invite-only.
  - Linking an invite by e-mail address is only safe when the auth server confirms addresses before
    issuing a session. It is therefore off by default (`TRUST_EMAIL_FOR_INVITES=false`) and switched
    on for the hosted instance. Self-hosted invites are claimed through a one-time invite link
    (sub-project 3).
  - No `members` row, or status `disabled` → "No access" page.
- Roles: `admin` (manage members, see instance status) and `member`. Admins see **only their own
  portfolios** — no admin view of client holdings.
- **TV pairing**: the TV shows a 6-character code (valid 10 min). A logged-in user enters it on
  `/pair` and names the device. The TV receives a random device token (stored hashed), which is
  **read-only** and revocable in settings.

## 4. Data model

All money columns are `numeric`. Times are UTC `timestamptz`; calendar days are `date`.

**Tenant data**

- `members` — `id`, `user_id` (auth user, null until first login), `email` (unique, lower case),
  `role` (admin|member), `status` (invited|active|disabled), `display_name`, `locale` (en|de),
  `base_currency` (default EUR), `timezone` (default Europe/Berlin), `created_at`, `last_login_at`.
- `portfolios` — `id`, `member_id`, `name`, `color`, `position`, `created_at`, `archived_at`.
- `transactions` — the **source of truth**. `id`, `portfolio_id`, `instrument_id`, `listing_id`
  (optional), `type`, `trade_date`, `quantity`, `price`, `currency`, `fx_rate` (base units per one
  unit of `currency` on `trade_date`; filled by the server when left empty), `fees`, `taxes`,
  `amount` (dividends), `split_ratio` (splits), `link_id` (pairs the two legs of an exchange),
  `note`, `source` (manual|import), `created_at`, `updated_at`.
- `tv_devices`, `pairing_codes` — see §3.

**Shared reference and market data** (one copy per instance, not per tenant)

- `instruments` — `id`, `name`, `isin`, `type` (stock|etf|etc|fund|bond|index|other), `sector`,
  `country`, `logo_url`, `default_listing_id`.
- `listings` — `id`, `instrument_id`, `mic` (exchange, ISO 10383), `symbol`, `currency`
  (incl. minor units such as GBX = pence), unique (`mic`, `symbol`).
- `quotes` — latest price per listing: `price`, `previous_close`, `as_of`, `source`.
- `daily_prices` (`listing_id`, `date`, `close`) — **one table**, not one table per ticker.
- `intraday_prices` (`listing_id`, `ts`, `price`) — kept 7 days.
- `fx_rates` (`currency`, `date`, `per_eur`) daily (ECB) and `fx_latest` (`currency`, `per_eur`,
  `as_of`) intraday from the provider. Cross rates are derived through EUR.
- `reference_dividends` (`listing_id`, `ex_date`, `amount`, `currency`) — for yield display.
- `job_status` (`job`, `last_run_at`, `last_success_at`, `last_error`).

Exchanges (MIC, name, country, currency, time zone, trading hours) are a static table in
`packages/core`, not a database table.

## 5. Ledger and performance rules (`packages/core`)

**Cost method: average cost**, as German brokers display "Einstandskurs". Fees are part of the
cost basis. All base-currency amounts use the transaction's `fx_rate`.

| Type | Quantity | Cost basis | Realized / income |
|---|---|---|---|
| `buy` | + q | + q·price + fees + taxes (stamp duty, transaction tax) | — |
| `transfer_in` ("take over existing holding") | + q | + q·price (price = average cost) | — |
| `sell` | − q | − q·avgCost | realized += q·price − fees − q·avgCost |
| `transfer_out` | − q | − q·avgCost | — |
| `split` | · ratio | unchanged | — |
| `exchange_out` + `exchange_in` (merger, e.g. New Gold → Coeur) | out − q₁, in + q₂ | out's q₁·avgCost moves to in | none |
| `dividend` | — | — | income += amount − taxes (gross kept too) |

- Order of application: `trade_date`; within one day splits, then exchange legs, then buys and
  transfers in, then dividends, then sells and transfers out; then creation time. (Amended
  2026-09-26: entries of one day can be typed in any order without a false "oversell" error. A
  same-day sell followed by a rebuy is therefore computed as rebuy-then-sell; an intraday sequence
  field can refine this later.)
- Fees and taxes are only accepted on buys, sells and dividends; transfers and splits reject them.
- Selling or transferring out more than is held is rejected with a validation error.
- A holding without a known price is valued as "no price" and is excluded from value **and** cost
  on both sides of every return (lesson from Lahontan in the family app).

**Valuation and returns**

- Daily value series = holdings on that day (from the ledger) × close × FX of that day. A close
  older than 7 days is treated as missing, not carried forward.
- Returns are **time-weighted** (flows neutral), the same convention as Portfolio Performance's
  TTWROR: daily return `r_t = (V_t + Out_t) / (V_{t−1} + In_t) − 1`. Money coming in (buys incl.
  costs, transfers in at market value) counts at the start of the day; money going out (sell
  proceeds, transfers out at market value, net dividends) at the end of the day. (Amended
  2026-09-26: the earlier single net-flow formula turns negative when a whole position is sold
  above the previous close.)
- Periods: 1D, 1W, 1M, MTD, YTD, 1Y, 3Y, 5Y, since start. Month and year starts follow the
  member's time zone.
- Also shown: unrealized gain, realized gains, dividends, total return in money, and the
  "today's holdings over the past years" chart, clearly labelled as hypothetical.
- Benchmarks (MSCI World, S&P 500, DAX, gold) are ordinary listings flagged in instance settings.

## 6. Market data (`packages/market-data`, `apps/worker`)

```ts
interface MarketDataProvider {
  id: string
  search(query: string): Promise<ListingCandidate[]>        // name, symbol, mic, currency, isin?, type
  quotes(listings: ListingRef[]): Promise<Quote[]>
  dailyHistory(listing: ListingRef, from: Date): Promise<DailyBar[]>
  fxLatest?(currencies: string[]): Promise<FxQuote[]>
  dividends?(listing: ListingRef, from: Date): Promise<Dividend[]>
  profile?(listing: ListingRef): Promise<Profile>           // isin, sector, country, logo
}
```

- Listings are identified by `mic` + `symbol`; each adapter maps MICs to its own suffixes.
- Adapters in scope: `yahoo` (self-host default, no key, private use), `ecb` (daily FX, free),
  and the paid provider chosen for the hosted instance (§9).
- Worker jobs, each recording `job_status`:
  - **quotes** every 5 min (configurable) for every listing held by any active portfolio or used
    as benchmark, only while its exchange is open plus one run after close; each run also appends
    `intraday_prices` and purges points older than 7 days;
  - **fx** latest every 15 min, ECB daily after 16:30 CET;
  - **backfill** for new listings (up to 10 years of daily closes) within a minute of first use;
  - **history** nightly, re-fetching the last 10 days to pick up corrections;
  - **dividends / profile** weekly.

## 7. User interface (`apps/web`)

Visual language carried over from the family tracker (dark, calm, large numbers, logos, sparklines),
with light and dark themes and a phone layout. All strings in `messages/en.json` and
`messages/de.json`; locale from the member setting, then `Accept-Language`, then English.

| Route | Content |
|---|---|
| `/login`, `/auth/callback`, `/no-access` | e-mail + password, forgot password, invite acceptance |
| `/` | total value, day change, total return, chart with ranges, allocation, one card per portfolio |
| `/p/[id]` | positions table (security, quantity, avg cost, price, value, day %, gain), transactions tab |
| `/p/[id]/i/[instrumentId]` | position detail: chart ranges, key figures, transaction list with edit/delete |
| transaction sheet (from anywhere) | tabs Buy / Sell / Dividend / Take over holding / More (split, exchange); security search with autocomplete; date, quantity, price, currency, fees, taxes, note; live total; sell shows the available quantity |
| `/import` | CSV upload → preview with per-row validation → confirm |
| `/settings` | name, language, base currency, time zone, TV devices, CSV export, delete account |
| `/admin` | members (invite, disable, delete), instance status (jobs, provider, last quote) |
| `/tv`, `/pair` | TV mode (generalized port of the current projector scenes) and pairing |

CSV template columns: `date, portfolio, type, isin, symbol, exchange, quantity, price, currency,
fees, taxes, amount, note`.

## 8. Android (`apps/android`)

- One app for phone and TV (launcher + leanback launcher), Kotlin, WebView around the web app.
- First start: native screen "JBP Capital (portfolio.jbpcapital.de)" or "Own server" with URL
  entry, validated through `GET /api/health` (`{"app":"portfolio-viewer","version":…}`).
  Changeable later from the app menu.
- Phone loads `/`, TV loads `/tv` (pairing flow). Native extras: offline screen with retry, keep
  screen on in TV mode, D-pad and Back passed to the page, file picker for CSV import, external
  links in the browser, app version in the user agent.
- Release: signed Android App Bundle, Play App Signing, internal testing track first, then
  production. Store listing in English and German, phone and TV screenshots, privacy policy on
  jbpcapital.de.
- Known risk: Google Play's "minimum functionality" rule for WebView apps; the native server
  selection, TV support and offline handling are the answer to it.

## 9. Hosting at portfolio.jbpcapital.de

- Coolify (JBP/private instance), domain `portfolio.jbpcapital.de` behind Cloudflare (Coolify
  domain field `http://…` when served through a Cloudflare tunnel).
- Dedicated Postgres with daily backups; auth = Supabase of jbpcapital.de. Requires there: the
  redirect URL `https://portfolio.jbpcapital.de/**` on the allow list and the service-role key for
  invites.
- **Market data provider (decision pending, the owner):** research of 2026-09-26 found no self-serve plan
  that is both cheap and licensed for showing data to clients:
  - EODHD — best coverage (TSXV, TSX, LSE, ASX, Xetra, Frankfurt, OTC; 15–20 min delayed), display
    rights only on a quoted Custom plan from about 399 USD/month;
  - Twelve Data "Venture" — 149 USD/month, display to clients explicitly allowed, but non-US prices
    end-of-day only and non-US commercial use needs their written approval.
  - Action: request quotes from both in writing. The hosted instance does not go live with
    unlicensed data.
- GDPR: CSV export and account deletion in the app; privacy policy section on jbpcapital.de.

## 10. Security

- Server-only data access; route handlers call `requireMember()` / `requireAdmin()` /
  `requireDevice()` and then repository functions that take the member id as their first argument.
- **Isolation tests**: for every repository function, member B can neither read, change nor delete
  member A's portfolios, transactions, devices or settings.
- TV tokens: 32 random bytes, stored as SHA-256, `httpOnly` cookie, read-only.
- No secrets in the repository; `gitleaks` runs in CI before the repository is made public.

## 11. Sub-projects and order

1. **Core** — repository scaffold, `packages/core` ledger + returns, `packages/db` schema,
   migrations and repositories, auth + access gate, self-host compose (db, auth, web, worker).
2. **Market data** — provider interface, Yahoo + ECB adapters, worker jobs, symbol search.
3. **Input** — portfolios, transaction sheet, position detail with edit/delete, CSV import/export.
4. **Display** — dashboard, charts, returns, benchmarks, TV mode + pairing (port of the family
   views, generic), i18n complete.
5. **Android** — app, Play Store internal track, then production.
6. **Hosted** — portfolio.jbpcapital.de, jbpcapital.de auth, invites, paid provider adapter.
7. **Open-source release** — README, self-hosting guide, CONTRIBUTING, SECURITY, AGPL, public
   images (GHCR), repository made public.
8. **Later** — family migration (importer for the family's spreadsheet and its ledger), decided by
   the owner.

Each sub-project gets its own implementation plan in `docs/superpowers/plans/`.

## 12. Out of scope (v1)

Broker API synchronisation, realtime streaming prices, FIFO / tax reports, sharing portfolios
between logins, options and crypto, push notifications, iOS app.

## 13. Success criteria

- Fresh machine: copy `.env.example`, set four values, `docker compose up -d` → the first sign-up
  becomes admin, creates a portfolio, records a buy, and sees a valued position within one quote
  cycle.
- Ledger unit tests cover every transaction type, including merger and split, and returns match
  hand-computed examples.
- Isolation tests green for every repository function.
- Every UI string exists in `en.json` and `de.json` (test fails on a missing key).
- Hosted: an invited client logs in with their jbpcapital.de account; an uninvited account sees the
  "No access" page.
- Android: installable from the Play Store (internal track first), works on phone and TV, server
  selectable.
