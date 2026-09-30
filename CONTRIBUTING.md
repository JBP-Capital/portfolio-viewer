# Contributing to Portfolio Viewer

Thank you for helping. Bug reports, fixes and translations are welcome. For a larger feature, please open
an issue first so we can agree on the approach before you spend time on it.

## Layout

| Path | What it is |
|---|---|
| `packages/core` | Pure maths: ledger, returns, currencies, dates. No I/O. |
| `packages/db` | PostgreSQL schema, migrations and repositories (Drizzle). |
| `packages/market-data` | Price providers (Yahoo, ECB, demo). |
| `apps/web` | The Next.js app, including TV mode and the API. |
| `apps/worker` | Scheduled jobs: quotes, daily closes, exchange rates. |
| `apps/android` | The Android app for phones and TVs. |
| `deploy` | Docker Compose setup for self-hosting. |
| `docs` | Design, plans and the status log. |

## Setup

You need Node.js 24 and Docker. For the Android app you also need JDK 21 and the Android SDK (platform 36).

```sh
npm ci
npm run typecheck
npm test            # the packages/db tests start PostgreSQL in Docker (Testcontainers)
```

The end-to-end tests run against a fresh instance with made-up prices. In `deploy/.env`, set:
- `MARKET_DATA_PROVIDER=demo`
- `PORT=3310`
- `PUBLIC_URL=http://localhost:3310`

Then run:

```sh
cd deploy && docker compose down -v && docker compose up -d --build
cd ../apps/web && E2E_RUN=$(date +%s) E2E_BASE_URL=http://localhost:3310 npx playwright test
```

To try a change in the running app, rebuild the containers: `docker compose up -d --build` in `deploy`.

Android:

```sh
cd apps/android && ./gradlew testDebugUnitTest lintDebug assembleDebug
```

## Rules

- **English everywhere in the repository:** code, comments, commit messages, documentation and every
  text a user sees. The German translation lives only in `apps/web/messages/de.json`,
  `apps/android/app/src/main/res/values-de` and the German store texts in `docs/android`. A new
  user-facing text needs both languages.
- **Tests with every change:** a bug fix comes with a test that fails without it. New behaviour comes with
  tests at the lowest level that can show it (core before db before e2e).
- **All checks pass before a pull request:** `npm run typecheck`, `npm test` and `npm run build -w @pv/web`.
  If you changed the app, run the e2e tests; for Android, run the Gradle line above. CI runs the same checks.
- **Match the surrounding code:** naming, comment style and structure. Keep changes focused on one thing.
- **Commit messages** in the imperative mood with a type prefix, e.g. `fix(web): keep the range when
  switching portfolios`.

## License of contributions

Portfolio Viewer is licensed under the GNU AGPL-3.0. By sending a pull request you agree that your
contribution is licensed under the same terms.

## Security issues

Please do not open public issues for vulnerabilities; see [SECURITY.md](SECURITY.md).
