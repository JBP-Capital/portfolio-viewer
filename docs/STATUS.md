# Status log

## 2026-09-30 — sub-project 7a done (open-source release prepared)

Branch `feat/open-source-release`, plan `docs/superpowers/plans/2026-10-02-open-source-release.md`.

### Built
- Every page links to its source code (AGPL-3.0 §13) with the running version; `SOURCE_URL` points it at
  a fork (an invalid value falls back to this repository instead of stopping the app).
- `.github/workflows/release.yml`: a tag `vX.Y.Z` on `main` (checked against the app version) builds the
  `web` and `worker` images for amd64 and arm64, pushes `ghcr.io/jbp-capital/portfolio-viewer-{web,worker}`
  as `X.Y.Z`, `X.Y` and `latest` (pre-release tags only their own version), and creates the GitHub release.
  The compose file pulls those images and still builds from source with `--build`.
- README, self-hosting guide (install, update, tested backup and restore, HTTPS with Caddy, TV and Android,
  `SOURCE_URL`), CONTRIBUTING, SECURITY, screenshots. The permissive `.claude/settings.json` left the tree;
  no local paths or internal notes (the private family repository's contents, vendor questions) remain.
- Found by installing from a fresh clone with real data: the worker loaded the ECB history only for
  currencies already held, so the first purchase in dollars asked for an exchange rate by hand → it now
  keeps the daily rates of all 29 ECB currencies (73,868 rates, ten years, loaded in under a minute).

### Verified
- Fresh clone, README quick start word for word: four containers healthy, first account is administrator,
  portfolio created, SAP bought on Xetra and on NYSE (dollar rate found automatically), prices loaded from
  Yahoo. arm64 builds of both images run (emulated). actionlint clean; gitleaks: no leaks in the history.
- Backup and restore as written in the guide, in Git Bash: same accounts, portfolios, transactions and
  logins in a brand-new instance, sign-in works.
- Typecheck exit 0; core 95, db 120, market-data 21, web 71, worker 13 (+4 live skipped); build exit 0;
  e2e 25/25 on a fresh stack; Android tests and lint pass.

### Final review (independent, whole branch) — fixed
- Internal notes in STATUS and the spec (which secrets the private family repository holds, vendor price
  questions, client counts) → removed.
- The update steps overwrote a modified build or did nothing after a source build → separate recipes for
  published images and source builds; pinned versions come with `git checkout vX.Y.Z`.
- Backup with `>` corrupts the file in Windows PowerShell, and a restore right after `up -d db` could hit the
  temporary first-start server → the dump is written inside the container, the database health check
  waits for the real server (TCP), `up -d --wait db`.
- A currency the ECB stops publishing was requested every minute for ever → per-currency waiting time
  ("no newer rates", worker test).
- Pre-release tags became `latest` and the release job had write access everywhere → fixed; a tag must
  point at a commit on `main`.
- Deferred: `/tv` has no source link (the TV shows only what a member already sees elsewhere); the
  release images of web and worker are pushed by separate jobs, so a failed worker build after a
  successful web build leaves `latest` on mixed versions until the next tag.

### Open — the owner's part (making it public)
The history was squashed into a single starting commit on 2026-09-30 (the earlier history is kept privately
by the maintainer), and the first release tag `v0.1.0` is pushed right after that commit; it starts the
release workflow. Nothing below can be done by the code alone; the order matters.
1. **Turn on private vulnerability reporting:** GitHub → repository `JBP-Capital/portfolio-viewer` →
   Settings → Advanced Security (Code security) → Private vulnerability reporting → Enable. Without it the
   "Report a vulnerability" button in SECURITY.md does not exist.
2. **Check the release:** Actions tab → the run "release" must end green (10–20 minutes); it builds and
   pushes both images and creates the GitHub release with generated notes. Should it fail, fix the cause
   and push the tag again (`git push --delete origin v0.1.0`, then tag and push again). A tag made by hand
   works too: `git tag v0.1.0 && git push origin v0.1.0` from a checkout of `main`; a release drafted by hand
   on GitHub is fine, the workflow copes with it.
3. **Make both images public:** GitHub → organisation JBP-Capital → Packages → `portfolio-viewer-web` →
   Package settings → Change visibility → Public; the same for `portfolio-viewer-worker`. New packages are
   private, even when the repository is public.
4. **Test as a stranger:** run `docker logout ghcr.io`, then
   `docker pull ghcr.io/jbp-capital/portfolio-viewer-web:0.1.0`. It must download without a login.
5. **Make the repository public:** Settings → General → Danger zone → Change repository visibility → Public.

## 2026-09-29 — sub-project 4c done (hypothetical chart, moves between portfolios, TV detail)

Branch `feat/display-4c`, plan `docs/superpowers/plans/2026-10-01-display-4c.md`.

### Built
- Hypothetical chart on the dashboard and on every portfolio page, below the performance block:
  today's holdings valued at each past day's close in the base currency, over the page's range
  (calendar start, not the first trade; Max = the ten years of stored prices), with a table view.
  Labelled "Hypothetical: today's holdings at past prices" with a sentence on what it leaves out.
- Moves between own portfolios: in the combined series of all portfolios, a transfer out and a
  transfer in of the same security, day and quantity cancel out and count as no money in or out, so
  the day return is the price change. A single portfolio still counts them as money in or out.
- TV security detail: on card scenes OK marks a card (gold outline, the rotation holds), the arrows
  move the mark within the page, OK opens a full-screen detail (value, price, today, quantity,
  unrealized gain, one year of prices in the listing's currency; privacy mode hides money and
  quantity). OK returns to the card, Back to the running scene; ▲ from the top row or Back removes the
  mark; a mark closes itself after 5 minutes without a key. The Android app asks the page
  (`window.pvTvBack()`) before Back leaves the app.

### Decisions
- The hypothetical line counts only securities with a price today and starts once all of them have a
  price; otherwise a missing or late price history shows as a jump that is no price move. The sentence
  under the chart says so.
- The one-year prices for the TV detail travel with the TV snapshot, one series per listing thinned
  out to 120 points (about 5 KB per listing on each 5-minute reload), not per card, since a security
  appears in the holdings scene and in its portfolio's scene.
- On card scenes OK marks instead of pausing; a paused screen resumes with OK first. Pausing stays on
  the play key and the footer button, as in the family app.

### Final review (independent, whole branch) — fixed with regression tests
- The TV mark pointed at a list position: after the 5-minute reload a re-sorted or shorter list showed
  another security's detail, or Back left the app instead of closing the detail → the mark keeps the
  security and its scene, follows the card to its page or closes when it is gone (web tests).
- The hypothetical line summed whatever had a price: a security whose price stopped dropped out, and a
  security listed later made the line jump → see the decision above (core and db tests).
- Moves along a chain of portfolios on one day (A→B, B→C) were not always recognised, depending on the
  order of the rows → transfers are paired per security, day and quantity (db test).
- The TV loaded prices with two queries per listing on every reload → two queries for all listings.
- Back from the detail needed three presses to leave the app → Back returns to the running scene, the
  second Back leaves (e2e; checked on the TV emulator).
- Deferred: the dashboard loads transactions and closes once for the performance block and again for
  the hypothetical chart; fine at family size, worth merging before large hosted portfolios.

### Verification
- Typecheck exit 0; tests core 95, db 120, market-data 20, web 69, worker 11 (+4 live skipped);
  `next build` exit 0; e2e 24/24 on a fresh compose stack (hypothetical chart reaching five years back,
  TV mark, detail, OK/Back, `pvTvBack`).
- Android: unit tests, lint and debug build pass; on the Android TV emulator: OK marks, OK opens the
  detail, the first Back returns to the running scene, the second Back leaves the app.
- Screenshots checked: hypothetical chart at 1280 px (dark) and 390 px (light); TV mark, detail and
  detail in privacy mode at 1920×1080.

### Open
- 5b: Google Play (Jim's part, steps in the 5a entry below).
- 6: hosted instance (blocked: market-data provider decision).
- 7: open-source release.

## 2026-09-27 — sub-project 5a done (Android app)

Branch `feat/android`, plan `docs/superpowers/plans/2026-09-30-android.md`.

### Built
- `apps/android`: one app for phones and TVs (`de.jbpcapital.portfolioviewer`, version 0.1.0, min
  Android 7.0, target Android 16). First start asks for the server (default
  `https://portfolio.jbpcapital.de`) and accepts it only when `/api/health` answers as Portfolio Viewer.
  Phones open `/`, TVs `/tv` with the screen kept on. Offline page with automatic retry (15 s, 30, 60,
  then every 2 minutes), "Try now" and "Change server"; launcher shortcut "Change server". CSV import
  through the file picker, CSV export to Downloads with the sign-in. Other sites open in the browser;
  `file:`, `content:` and `intent:` links never open in the app. English and German (`values-de`).
- Icons, TV banner, Play Store icon and feature graphic drawn from the JBP Capital logo
  (`apps/android/scripts/make-icons.ps1`); four TV screenshots in `docs/android/screenshots`.
- CI: a second job builds the app, runs its unit tests and Android lint.
- Store texts (EN/DE), data-safety answers and a privacy-policy draft in `docs/android/`.
- Signed release bundle `portfolio-viewer-0.1.0.aab`. The bundle, the upload key and its password are
  kept on the maintainer's machine, never in the repository.

### Verified on the Android TV emulator (1080p)
- Server check, pairing with a code typed on `/pair`, all scenes, remote keys (◀ ▶, digits, 0 for
  privacy), the device token kept after the app was force-stopped, the offline page while the web server
  was stopped, and the automatic return once it came back. The TV returns table was too narrow at the
  960 CSS px of Android TV and was widened.
- Android unit tests 5/5, lint clean, debug and signed release builds.

### Final review (independent, whole branch) — fixed and verified
- Android 15/16 phones draw apps edge to edge: the page ran under the status bar, navigation bar and
  keyboard → the app keeps the page clear of them (checked on an Android 16 phone emulator: sign-in with
  the keyboard open, dashboard).
- Back looped on the offline page, and the old offline page came back after recovery → Back leaves the
  app while offline, the history is cleared after an outage (unit tests; checked on the phone emulator).
- Also fixed: retries now wait 15/30/60/120 s and pause in the background; the Menu key of a TV remote
  opens the server screen (TV launchers show no shortcuts); addresses are read like a browser reads them
  (international names, underscores, `|` in links); the health check must be JSON; `http://` servers
  that redirect to `https://` on the same host are taken as https; renderer crashes restart the page;
  the unused storage permission is gone; CSV picker on Android 7–9; wording in the privacy draft.
- Found while testing: a fresh sign-in was lost if the app was killed within about 30 seconds (the web
  app changes pages without full loads, so cookies were not yet on disk) → cookies are written at once
  when they change (checked: force-stop 6 s after sign-in keeps the session).
- Found while testing, **affects every self-hosted server**: after a host restart Docker starts all
  containers at once; when Postgres was still starting, the web app's migration failed once and the
  server answered every request with an error until someone restarted it → migrations retry for up to
  two minutes, then the process exits so Docker restarts it (unit test; checked by stopping the database,
  restarting the web container and starting the database 10 seconds later).
- Verification: Android unit tests 14, lint clean; core 90, db 114, market-data 20, web 61, worker 11
  (+4 skipped); typecheck and build exit 0; e2e 23/23 on a fresh stack. The release bundle in Downloads
  was rebuilt with all fixes.

### Decisions
- Cleartext HTTP is allowed: self-hosters run `http://` servers on their home network and type that
  address on purpose.
- The German store texts and `values-de` are the German translation the approved spec asks for.

### Open — Jim's part (Google Play)
The app cannot be published without Jim's Play Console account. Real use also needs the hosted instance
(sub-project 6); until then the app works with any self-hosted server.
1. Open https://play.google.com/console with the Google account that owns the developer account. Click
   **Create app**: name "Portfolio Viewer", default language English (United States), App, Free; tick the
   declarations; **Create app**.
2. Left menu **Test and release → Testing → Internal testing → Create new release**. Accept Play App
   Signing when asked. Upload `portfolio-viewer-0.1.0.aab` (the maintainer's copy), release name "0.1.0",
   **Next → Save and publish**.
3. Tab **Testers**: create an e-mail list with your own address, save, copy the join link, open it on the
   phone or TV and install the app from Play.
4. **Grow users → Store presence → Main store listing**: texts from `docs/android/store-listing.md`,
   `icon-512.png`, `feature-graphic.png`, TV screenshots. **App content**: privacy policy link (publish
   `docs/android/privacy-policy.md` on jbpcapital.de after filling in the parts marked "to confirm"),
   data-safety answers, content rating questionnaire, target audience 18+.
5. For the TV: **Test and release → Advanced settings → Form factors → Android TV → Add**, upload the TV
   screenshots, opt in to the Android TV review.
If the upload is refused because version code 1 is taken, tell me and I build 0.1.1. When done, write
"Play internal testing is live" in the chat (or paste the error); I then handle the next release.

## 2026-09-27 — sub-project 4b done (TV mode and pairing)

Branch `feat/tv`, plan `docs/superpowers/plans/2026-09-29-display-4b-tv.md`.

### Built
- Pairing: `/tv` in any browser without a device shows a 6-character code (no 0/O/1/I, 10 minutes).
  On a phone the member opens `/pair`, types the code (case and dash do not matter) and names the
  TV. The TV then gets a read-only device token (32 random bytes, only its SHA-256 stored, httpOnly
  cookie `pv-tv`, 400 days). The token goes only to the browser holding the pairing's poll secret,
  so reading the code off the screen is not enough. 10 wrong codes per member per 15 minutes; at
  most 1000 codes waiting at once (the pairing route needs no sign-in). Migration 0008.
- Settings: "TV devices" lists paired TVs (paired on, last used) with Remove; a removed TV shows the
  pairing screen again on its next load. A disabled or deleted member's TVs show nothing.
- TV mode: scenes Overview (total, today, total return, unrealized, value over one year), Today
  (gainers and losers), Holdings and one scene per portfolio (cards, up to 12 per page, fewer cards
  get more room), Performance (1M/6M/1Y/5Y as far as the history reaches: comparison chart and
  returns table), Allocation. Remote: ◀ ▶ scene, ▲ ▼ page, OK pause, 0 hide amounts (money and share
  counts hidden, percentages stay), 1–9 jump, media keys; footer buttons for clicks and taps;
  automatic rotation (20 s, pages 12 s, 60 s hold after a key); data reload every 5 minutes; the
  member's language and time zone, whatever the TV's browser uses. A signed-in member's browser also
  opens `/tv` directly (projector laptop).

### Final review (independent, whole branch) — fixed with regression tests
- A TV that runs all day stayed on an error page after one failed refresh (server restart) → it
  refreshes only when `/api/health` answers, and an error page reconnects with back-off (web test).
- `/pair?code=…` filled in the code, so a crafted link could make a member pair an attacker's
  browser with one click → no code or name is taken from the address; a warning explains what
  pairing grants (e2e).
- The progress bar ran out after 30 of 60 seconds after a key press → the step length is fixed when
  it starts (e2e).
- Also fixed: 20 parallel wrong codes all counted instead of stopping at 10 (per-member lock, db
  test); removing an already removed TV; `/pair` returns to `/pair` after sign-in; pairing polls one
  at a time with a server-side countdown and back-off when busy; logo on the pairing screen; dates
  in the member's time zone; larger labels.
- Deferred: a per-IP limit on the open pairing route (before the hosted instance); privacy mode
  read after the first paint; the device cookie is not renewed after 400 days.

### Verification
- Typecheck exit 0; tests core 90, db 111, market-data 20, web 61, worker 11 (+4 live skipped);
  `next build` exit 0; e2e 23/23 on a fresh compose stack (TV pairing with two browsers, privacy,
  steady progress bar, removal, /pair ignores the address).
- Screenshots checked at 1920×1080 and 1280×720: all six scenes, privacy mode.

### Open
- 4c (stock detail on the TV, hypothetical history chart, transfers between own portfolios).
- Next: sub-project 5 (Android app for phone and TV).

## 2026-09-27 — sub-project 4a done (dashboard, charts, returns, benchmarks)

Branch `feat/display`, plan `docs/superpowers/plans/2026-09-28-display-4a.md`.

### Built
- Dashboard `/`: total over all active portfolios (holdings merged per security), value chart and
  comparison chart for a range (`?range=1M|6M|YTD|1Y|5Y|MAX`, default 1Y), returns table (1 month
  … since first trade) for the portfolio and each benchmark, allocation by sector, currency and
  country, today's three largest rises and falls, portfolio cards.
- Portfolio page: the same performance block above the positions. Position page: price chart in the
  listing currency with buys and sells marked.
- Benchmarks: `benchmarks` table (migration 0007) with EUR ETFs on Xetra — EUNL (MSCI World), SXR8
  (S&P 500), EXS1 (DAX), 4GLD (gold). The worker adds missing defaults at start and daily at 02:20;
  benchmark listings count as in use, so backfill loads ten years and quotes stay current.
- Maths: daily values from the ledger with closes carried over weekends and holidays (7 days at most,
  like `valuePortfolio`), today's quote and the latest rate for the last day; time-weighted returns;
  benchmark returns in base currency; charts limited to 400 points.
- Charts: own SVG line chart (no library) — crosshair tooltip listing every series, arrow keys /
  Home / End, screen-reader announcement, legend for two or more series, validated palette for both
  themes (`--series-1..5`), month-end values as a table under the value chart.
- Header and sign-in page: "by" and the JBP Capital logo (from the jbpcapital.de website, drawn as a
  mask in the text colour) instead of the written "by JBP Capital Software" (Jim's request).

### Decisions
- Benchmarks are ETFs, not indices: real prices from every provider, no index licence, all
  accumulating. Comparison and returns for a range that starts with the first trade are counted from
  the day before it, so the first day's gain counts (same as the MAX return).
- Buying below the day's close shows as a gain on that day (the demo data does this on purpose in the
  e2e buys, which is why the demo charts jump in January 2026).

### Final review (independent, whole branch) — fixed with regression tests
- Dashboard series: a split booked in two portfolios holding the same security was applied twice to
  the combined holding (8,000 instead of 2,000) → the ledger is keyed per portfolio (db test).
- The chart's last day used the ECB rate and the stored close while the headline used the live rate
  and quote → one rule: the latest quote/rate replaces a same-day stored row; a UTC date one day
  ahead of the member's day counts for today (db tests).
- Close lookups took ~1 s for 10 years × 60 positions → stale limit cached per date, ~0.1 s (core
  test); held listings load from the first trade only.
- Also fixed: YTD for a portfolio started on 2 January (only weekend/New Year before the first trade
  counts as covered), benchmark colours fixed per slot, trade markers on the drawn line, tap shows
  the tooltip, money at the allocation bars, "By exchange country" label, total return in money on
  the summary (spec §5/§7).
- Deferred (PLAN 4c): the hypothetical "today's holdings over the past years" chart; a transfer
  between two of the member's own portfolios understates the dashboard return on that day.

### Verification
- Typecheck exit 0; tests core 90, db 100, market-data 20, web 44, worker 11 (+4 live skipped);
  `next build` exit 0; e2e 20/20 on a fresh compose stack (demo provider).
- Screenshots checked: dashboard 1280 px dark and light, 390 px phone (no sideways scrolling),
  tooltip, position chart with keyboard focus, header and sign-in with the logo in both themes.

### Open
- Next: sub-project 4b (TV mode `/tv` with pairing codes and read-only device tokens).

## 2026-09-27 — sub-project 3b done (cloud session)

Branch `feat/input-3b`, plan `docs/superpowers/plans/2026-09-28-input-3b.md`.

### Built
- CSV import at `/import`: every row checked (German and English files, file line numbers), preview,
  all-or-nothing confirmation from a server-side draft; missing portfolios created; unknown
  securities added through the provider. CSV export (`/api/export`, template with `?template=1`)
  in the same format, merger legs included — an export imports again.
- `/settings`: name, language (restored at sign-in on other devices), time zone, base currency
  (locked once transactions exist), account deletion (typed e-mail; last admin refused).
- `/admin`: one-time invite links (32 random bytes, SHA-256, 7 days, single use), withdraw, disable,
  make admin, delete members; `/invite/[token]` with sign-up/sign-in that return to the link.
- Migrations 0005 (`import_drafts`), 0006 (`invites`).

### Final review (independent, whole branch) — fixed with regression tests
- Open redirect after sign-in via dot segments (`/.//evil.com`) → refused (web test).
- A stray `"` in an unquoted CSV field swallowed later rows → quotes only open at a field start;
  delimiter-only rows skipped; issues name the file line (core tests).
- Confirming a preview twice imported it twice → the draft is used up in the import transaction
  (parallel db test).
- CSV of 1–2 MB failed silently (server-action limit 1 MB) → limit 3 MB, size checked in the form.
- Hosted: deleting a portfolio account would have deleted the shared jbpcapital.de login → the login
  is removed only when the instance owns its login service (web test); failures are logged.
- Minor: `fx_rate` in CSV per major unit like the form; ambiguous portfolio names refused; ISIN of a
  row stored only when the provider confirmed it; merger legs and dividend share counts round-trip;
  base-currency change vs. concurrent write, and two admins demoting each other — both reproduced in
  tests and fixed with row/advisory locks.
- Verification: typecheck exit 0; tests core 80, db 84, market-data 19, web 30, worker 11 (+4 live
  skipped); `next build` exit 0; e2e 16/16 on a fresh compose stack (demo provider); screenshots
  of import preview, settings, admin (desktop, phone), invite page (phone, German).

### Open
- Hosted instance (sub-project 6): invite e-mails through the jbpcapital.de Supabase
  (`TRUST_EMAIL_FOR_INVITES`) are not built yet; with sign-up off there, invitees need that path.
- Next: sub-project 4 (display: dashboard, charts, returns, benchmarks, TV mode + pairing).

## 2026-09-27 — sub-project 3a done (cloud session)

### Final review (independent, whole branch) — fixed with regression tests
- Critical: an exchange rate typed per pound for a London (pence) listing was stored per penny as
  typed → cost basis 100× too high. Rates are now converted with `ratePerListingUnit` and shown back
  per major unit when editing (core test, e2e: 100 FRES at 1,500 GBX, 1.16 EUR/GBP → cost 1,740 EUR).
- German "0.385" was read as 385 (leading zero taken as a thousands group); "1.234,56" in English was
  accepted as 1.23456 → both fixed (core tests).
- Dividends, splits and transfers out could not be recorded for a sold-out position → sold-out
  positions are offered after the open ones (unit test).
- Splits and transfers out failed with "enter the rate" in currencies without reference rates, but the
  form has no rate field for them → no rate needed, stored with 1 (db test).
- Editing the date of an entry kept the old date's automatic rate → the pre-filled rate is dropped
  when the date changes (unit test).
- Minor: malformed ids gave a server error instead of "not found" (db test); the oversell message now
  names the quantity held on that date (core, web and e2e tests); a failed "Book split" is shown.
- Verification after the fixes: typecheck exit 0; tests core 61, db 53, market-data 19, web 25,
  worker 11 (+4 live skipped); `next build` exit 0; e2e 9/9 on a fresh compose stack (demo provider).

### Next
- Plan 3b written: `docs/superpowers/plans/2026-09-28-input-3b.md` (CSV import/export, settings,
  invites). Execute it the same way on a new branch `feat/input-3b`.

## 2026-09-27 — sub-project 3a: e2e green, before the final review (cloud session)

- Handover step 1 was already in the code (`value={selectedHeldId}`).
- Found while running the stack and checking screenshots, fixed with tests:
  - the web image did not install the `@pv/market-data` workspace (Dockerfile);
  - saving right after choosing a security new to the instance failed with "Please choose a
    security" (it is added in the background) → the picker shows "Adding …" and Save waits
    (new e2e test, seen failing first);
  - a refused or failed `POST /api/instruments` was silent → message in the picker (unit test);
  - sell / transfer-out form now shows the quantity held (spec §7; e2e asserts it);
  - transaction table: type column was labelled "Transactions"; rows now fit a phone screen.
- `deploy/README.md` and `.env.example` explain `MARKET_DATA_PROVIDER=demo`.
- Verification: typecheck exit 0; tests core 57, web 21, market-data 19, db 51, worker 11 (+4 live
  skipped); `next build` exit 0; e2e 8/8 against a fresh compose stack with the demo provider.
  Screenshots of `/p/[id]` checked at 1280×800 (light and dark) and 390×844 (German).
- Cloud-session notes (no Docker daemon, Node 22, Docker Hub rate limit): start `dockerd` by hand;
  Node 24 via `/opt/nvm`; pull `postgres:17-alpine`, `node:24-alpine`, `supabase/gotrue:v2.196.0`,
  `testcontainers/ryuk:0.14.0` from `mirror.gcr.io/...` and retag; image builds need
  `--network host`, the proxy build args and the proxy CA (kept outside the repository); Playwright
  needs `launchOptions.executablePath: '/opt/pw-browsers/chromium'`.

## 2026-09-27 — sub-project 3a in progress (handover point)

Branch `feat/input`, plan `docs/superpowers/plans/2026-09-27-input.md`.
- Done and committed: Task 1 (JBP look, app shell), Task 2 (decimal input, formatting), Task 3 (security
  search, future-date / unknown-security checks), Task 4 (valuePortfolio, split suggestions), Task 5 (demo
  provider, search API, transaction actions).
- Task 6 (portfolio page, transaction sheet, position detail) is written and committed as work in
  progress; Task 7's e2e files (`apps/web/e2e/01-selfhost.spec.ts`, `02-input.spec.ts`, `accounts.ts`)
  exist. Last e2e run: buy works; the sell step failed because the sell form had no security selected
  (held list empty when the sheet was first rendered).
- Next steps:
  1. In `components/portfolio/transaction-sheet.tsx` the `<Select>` for held securities must use
     `value={selectedHeldId}` (the derived id), not `value={heldId}`.
  2. Rebuild the stack (`deploy/.env` has `MARKET_DATA_PROVIDER=demo`), run
     `E2E_RUN=$(date +%s) E2E_BASE_URL=http://localhost:3310 npx playwright test` in `apps/web` until 7/7.
  3. Screenshots of `/p/[id]` (desktop and phone), then Task 7 docs (deploy/README demo provider), final
     whole-branch review, PR, merge. Then plan 3b (CSV import/export, settings, invitations).
- `deploy/docker-compose.yml` now passes `MARKET_DATA_PROVIDER` to the web container too (search).
- After 3a: final whole-branch review by a fresh reviewer, fixes with regression tests, PR into `main`,
  merge. Then write the plan for 3b (CSV import/export, settings incl. language and base currency — block
  base-currency changes once transactions exist, invitations with one-time links for self-hosting) and
  execute it the same way. Sub-projects 4 (display, TV), 5 (Android), 7 (open-source release) follow;
  6 (hosting) waits for the owner's market-data provider decision.

### Working rules for whoever continues (e.g. a cloud session)
- Everything in the repository is English; German only in `apps/web/messages/de.json`.
- Talk to the owner (Jim) in German, plainly; when something needs his action, give numbered steps.
- Work autonomously through the checklist: test first (see a test fail, then pass), run typecheck, tests
  and `npm run build -w @pv/web` after each step, commit with explicit paths
  (`git commit -m "..." -- <files>`) ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`,
  push regularly, keep `docs/PLAN.md` and this file current.
- Docker: `npm test -w @pv/db` and `apps/worker` need Docker (Testcontainers); the e2e suite needs the
  compose stack in `deploy/`. Check first whether Docker is available. If not, run everything else and
  list here which checks still need Docker, so they run when the laptop is back.

## 2026-09-26 — sub-project 2 (market data) done

### Built
- `packages/market-data`: provider interface; Yahoo adapter (search, listing details, batched latest
  prices via the spark endpoint, 10-year daily history with dividends and splits, intraday FX); ECB
  adapter (daily reference rates). Yahoo's split-adjusted closes are converted back to real closes.
- `packages/core`: trading hours of 37 exchanges (`isExchangeOpen`), provider currency codes
  (`GBp` → `GBX`), instrument types.
- `packages/db`: market tables (quotes, daily prices, intraday prices, latest FX, reference
  dividends and splits, job status) and their repositories.
- `apps/worker`: jobs for quotes (only open exchanges), intraday FX, ECB rates, backfill (10 years
  for newly held securities and currencies), nightly history refresh; croner schedule; container;
  `worker` service in compose.
- CI now also builds the web app; gitleaks pinned to v8.30.1.

### Verification
- Tests: core 49, db 38, market-data 10 (recorded real responses), worker 6 — all pass.
- Live test against Yahoo and the ECB (`LIVE_MARKET_DATA=1`): search finds AEM; prices for AEM (NYSE),
  LGCXF (OTC), LG (TSX Venture), PEY (TSX), FRES (London, GBX), RIO (ASX), 4GLD (Xetra), AE9
  (Frankfurt); Apple's real close before the 2020 split (499.24); ECB rates — 4/4 pass.
- Fresh `docker compose` stack with a holding of AEM and FRES: within 100 s the worker stored 2,514 and
  2,527 daily closes (2016-09-26 to 2026-09-25) and 2,560 ECB rates each for USD and GBP; all jobs
  succeeded. No quotes on the test day because it was a Saturday (exchanges closed, as designed).

### Review (independent, whole branch) — fixed with regression tests
- Gaps in prices/rates after worker downtime or when a shared listing is held again were never
  filled → backfill starts from the last stored day when data is older than 10 days; histories are
  stored in one transaction.
- One spark batch answered with 404 dropped all quotes → batches handled one by one.
- The running session's live price was stored as the day's close (ASX/Tokyo during the nightly run)
  → bars of unfinished sessions are dropped (`hasSessionEnded`).
- Unknown exchanges got a US listing's price (Tel Aviv TEVA) → no symbol, no price.
- Yahoo reports spin-offs as splits (GE 1281:1000) → numerator/denominator stored; only
  `isRegularSplit` ratios may ever be offered as split bookings.
- Failing listings were retried every minute and reported as success → back-off (5 min doubling to
  1 day) and partial failures in `job_status.last_error`.
- A database hiccup while recording job status ended the worker → status writes best effort.
- Found in the final smoke test: a network blip inside Docker ("fetch failed") was not retried →
  one retry after network errors.
- Smoke after the fixes: AEM 2,514 closes and Lahontan (TSXV) 1,118 closes since its 2022 listing,
  22 s after recording the holdings.

### Decisions
- HTTP timeout 45 s (ten years of history is ~270 KB; 15 s failed on a slow connection).
- Splits: providers deliver split events into `reference_splits`; booking them as `split`
  transactions for holders is part of sub-project 3 (otherwise a holder's value would drop by the
  split ratio when real closes continue after the split).

## 2026-09-26 — sub-project 1 (core) done

### Built
- `packages/core`: average-cost ledger (buy incl. fees and purchase taxes, sell, transfer in/out,
  split, dividend, merger/exchange), daily valuation series, time-weighted period returns (TTWROR
  convention), input schemas.
- `packages/db`: schema + 2 migrations, invite-only access gate (first account becomes admin),
  tenant-scoped portfolios/transactions that replay the ledger on every write under a portfolio row
  lock, FX-rate resolution from `fx_rates`, login throttle.
- `apps/web`: Next.js 16, English/German, GoTrue login (httpOnly session cookie), self-host auth
  proxy that forwards only e-mail links from outside, no-access page, portfolio list/create,
  `/api/health`, migrations on start.
- `deploy/`: Docker Compose (Postgres 17, GoTrue v2.196.0, web). GoTrue runs on plain Postgres with
  the roles created by `deploy/db-init/01-auth.sh`.

### Verification
- `npm run typecheck`: exit 0. `npm test`: core 43, db 31 (real Postgres via Testcontainers), web 13
  — all pass.
- Playwright against a fresh `docker compose up --build`: first account becomes admin and creates a
  portfolio (session cookie httpOnly); uninvited account sees "No access yet"; direct calls to the
  login service are refused (404); the 11th wrong password shows the throttle message;
  `/api/health` answers — 5/5 pass.
- gitleaks over the whole history: no leaks.
- Independent whole-branch review: 2 critical and 5 important findings fixed with regression tests
  (open redirect via tab/line break in `next=`, concurrent writes storing an oversold ledger,
  readable session cookie, unlimited password guessing through the open proxy, invites claimable by
  address under auto-confirm, false "no access" on parallel first requests, buy taxes ignored).

### Decisions
- Same-day order: splits, exchange legs, buys/transfers in, dividends, sells/transfers out (spec §5
  amended). Returns: `(V_t + Out_t)/(V_{t−1} + In_t) − 1`.
- Invites are linked by address only with `TRUST_EMAIL_FOR_INVITES=true` (hosted, where addresses
  are confirmed); self-hosted invites get a one-time link in sub-project 3.

### Carried into later sub-projects
- Sub-project 2: CI `next build` step and pinned gitleaks image; closes must be stored unadjusted
  (Yahoo closes are split-adjusted).
- Sub-project 3: reject future trade dates; block changing the base currency once transactions
  exist; invite links; validate that a listing belongs to its instrument.
- Sub-project 6/7: dedicated database role for the app instead of the superuser; check e-mail
  confirmation and rate limiting at the jbpcapital.de Supabase before enabling
  `TRUST_EMAIL_FOR_INVITES`.

## 2026-09-26 — design

### Decisions
- Product "Portfolio Viewer" (by JBP Capital Software), AGPL-3.0, new clean repository. The private
  repository of the family tracker is never published.
- Hosted instance `portfolio.jbpcapital.de` for advisory clients only, invite-only, login with
  jbpcapital.de accounts. Everyone else self-hosts.
- Approach C: Postgres + GoTrue + server-only data access; transactions are the source of truth.
- Android app id `de.jbpcapital.portfolioviewer` (cannot change after the first Play release).

### Open — needs the owner
- **Market data provider for the hosted instance:** a paid provider whose licence allows showing prices to
  the logged-in clients; decision pending.
- Family migration from the family's spreadsheet: decided later.
