# Open-source release (sub-project 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository ready to be published: every page links to its source (AGPL §13), tagged releases publish Docker images to GHCR, and README, self-hosting guide, CONTRIBUTING and SECURITY let a stranger run, back up and contribute to Portfolio Viewer. Making the repository public and pushing the first tag stay with the owner.

**Architecture:** A server-rendered footer reads `SOURCE_URL` (default: this repository). A tag-triggered GitHub Actions workflow builds the existing `web` and `worker` Dockerfiles for amd64 and arm64 and pushes them to `ghcr.io/jbp-capital/portfolio-viewer-{web,worker}`. The compose file pulls those images by default and still builds from source with `--build` (Compose builds when the pull fails, verified with Compose v5.1).

**Tech Stack:** Next.js 16 + next-intl, zod 4, Docker Compose, GitHub Actions (`docker/setup-qemu-action`, `docker/setup-buildx-action`, `docker/login-action`, `docker/metadata-action`, `docker/build-push-action`), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-09-26-portfolio-viewer-design.md` §1 (self-host with one `docker compose up`), §2 (repository private until release; the old repo is never published), §11 item 7 (README, self-hosting guide, CONTRIBUTING, SECURITY, AGPL, public images on GHCR, repository public).

## Global Constraints

- License: AGPL-3.0 (`LICENSE` is already the full text; `apps/web/package.json` says `AGPL-3.0-only`).
- Everything in the repository is English; the German UI texts live only in `apps/web/messages/de.json`.
- Self-host = 4 containers: `db`, `auth`, `web`, `worker`; one `docker compose up` in `deploy/`.
- Images: `ghcr.io/jbp-capital/portfolio-viewer-web` and `ghcr.io/jbp-capital/portfolio-viewer-worker`, tags `X.Y.Z`, `X.Y`, `latest`, platforms `linux/amd64,linux/arm64`.
- The product version is `apps/web/package.json` `version` (shown by `/api/health`); a release tag is `v` + that version.
- No secrets and no local paths of the maintainer's machine in the tree; gitleaks must pass over the whole history.
- Not in this plan: making the repository public, pushing a tag, enabling GitHub's private vulnerability reporting — owner's steps, listed in `docs/STATUS.md`.

## Review Focus

1. A newcomer on a clean machine follows the README quick start word for word → a running instance whose first account becomes admin (checked from a fresh clone in Task 3).
2. A backup made with the guide's command restores every login, portfolio and transaction into an empty instance (checked in Task 3, including the `auth` schema).
3. A tag whose version differs from `apps/web/package.json` → the release stops before any image is pushed (Task 2 workflow step, checked with the same shell line locally).
4. An operator who runs a modified copy sets `SOURCE_URL` to their fork; a value that is not an http(s) address is refused at start instead of rendering a `javascript:` link (Task 1 test).
5. Pages reached without signing in (login, invite, password reset) show the source link too, not only the signed-in shell (Task 1 e2e on `/login`).

---

### Task 1: Source link on every page (AGPL §13)

**Files:**
- Modify: `apps/web/lib/env.ts` (export `parseEnv`, add `SOURCE_URL`)
- Create: `apps/web/components/source-footer.tsx`
- Modify: `apps/web/components/app-shell.tsx`, `apps/web/components/auth-shell.tsx` (render the footer)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json` (`app.sourceCode`)
- Modify: `deploy/docker-compose.yml` (`SOURCE_URL` with the repository as default: an empty value would fail the start-up check), `deploy/.env.example`
- Test: `apps/web/test/env.test.ts`, `apps/web/e2e/01-selfhost.spec.ts`

**Interfaces:**
- Produces: `parseEnv(source: Record<string, string | undefined>): Env`; `Env.SOURCE_URL: string` (default `https://github.com/JBP-Capital/portfolio-viewer`); `<SourceFooter />` (async server component, no props).

- [ ] **Step 1: Failing tests** — `apps/web/test/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseEnv } from '../lib/env.ts'

const base = { DATABASE_URL: 'postgres://x', PUBLIC_URL: 'http://localhost:3000', AUTH_URL: 'http://127.0.0.1:3000' }

describe('SOURCE_URL', () => {
  it('points at this repository unless the operator runs a modified copy', () => {
    expect(parseEnv(base).SOURCE_URL).toBe('https://github.com/JBP-Capital/portfolio-viewer')
    expect(parseEnv({ ...base, SOURCE_URL: 'https://git.example.com/me/portfolio-viewer' }).SOURCE_URL).toBe('https://git.example.com/me/portfolio-viewer')
  })

  it('refuses anything but an http(s) address', () => {
    expect(() => parseEnv({ ...base, SOURCE_URL: 'javascript:alert(1)' })).toThrow()
    expect(() => parseEnv({ ...base, SOURCE_URL: 'not a url' })).toThrow()
  })
})
```

In `apps/web/e2e/01-selfhost.spec.ts`, add a test:

```ts
test('every page links to the source code', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('link', { name: /Source code \(AGPL-3\.0\)/ })).toHaveAttribute('href', 'https://github.com/JBP-Capital/portfolio-viewer')
})
```

- [ ] **Step 2: Run** `npx vitest run test/env.test.ts` in `apps/web` → FAIL (`parseEnv` is not exported).
- [ ] **Step 3: Implement** — in `env.ts` add to the schema

```ts
  /** Where users get this instance's source code (AGPL-3.0 §13); set it when running a modified copy. */
  SOURCE_URL: z.url({ protocol: /^https?$/ }).default('https://github.com/JBP-Capital/portfolio-viewer'),
```

and split parsing: `export function parseEnv(source: Record<string, string | undefined>): Env { return schema.parse(source) }`, `getEnv()` uses `parseEnv(process.env)`.

`components/source-footer.tsx`:

```tsx
import { getTranslations } from 'next-intl/server'
import pkg from '../package.json' with { type: 'json' }
import { getEnv } from '../lib/env.ts'

/** Links every page to the source code of this instance, as the AGPL asks of network services. */
export async function SourceFooter() {
  const t = await getTranslations('app')
  return (
    <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-muted sm:px-8">
      <a href={getEnv().SOURCE_URL} className="transition hover:text-text">
        {t('sourceCode', { version: pkg.version })}
      </a>
    </footer>
  )
}
```

Messages: en `"sourceCode": "Portfolio Viewer {version} · Source code (AGPL-3.0)"`, de `"sourceCode": "Portfolio Viewer {version} · Quellcode (AGPL-3.0)"`. Render `<SourceFooter />` after `<main>` in `AppShell` and at the end of `AuthShell`. Compose: `SOURCE_URL: ${SOURCE_URL:-https://github.com/JBP-Capital/portfolio-viewer}`; `.env.example` documents it.
- [ ] **Step 4: Run** unit tests, typecheck, rebuild the stack, e2e `01-selfhost.spec.ts` → PASS; screenshot the footer at 390 px and 1280 px.
- [ ] **Step 5: Commit** `feat(web): link every page to its source code (AGPL-3.0)`.

### Task 2: Published images

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `deploy/docker-compose.yml` (`image:` defaults to GHCR, `build:` stays), `deploy/.env.example` (`PORTFOLIO_VIEWER_VERSION`)

**Interfaces:**
- Consumes: `apps/web/Dockerfile`, `apps/worker/Dockerfile` (unchanged), build context = repository root.
- Produces: images `ghcr.io/jbp-capital/portfolio-viewer-web:<X.Y.Z|X.Y|latest>` and `…-worker:…`; compose variables `PORTFOLIO_VIEWER_VERSION` (default `latest`), `WEB_IMAGE`, `WORKER_IMAGE` (full override).

- [ ] **Step 1: Workflow** — `.github/workflows/release.yml`:

```yaml
name: release

on:
  push:
    tags: ['v*.*.*']

permissions:
  contents: write
  packages: write

jobs:
  images:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        app: [web, worker]
    steps:
      - uses: actions/checkout@v5
      - name: Tag matches the app version
        run: test "v$(node -p "require('./apps/web/package.json').version")" = "$GITHUB_REF_NAME"
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/jbp-capital/portfolio-viewer-${{ matrix.app }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/${{ matrix.app }}/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha,scope=${{ matrix.app }}
          cache-to: type=gha,mode=max,scope=${{ matrix.app }}

  release:
    needs: images
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: GitHub release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh release create "$GITHUB_REF_NAME" --generate-notes --title "Portfolio Viewer ${GITHUB_REF_NAME#v}"
```

Check the action majors against their current releases before committing (context7 or the actions' READMEs) and use the latest major of each.
- [ ] **Step 2: Compose** — `web.image: ${WEB_IMAGE:-ghcr.io/jbp-capital/portfolio-viewer-web:${PORTFOLIO_VIEWER_VERSION:-latest}}`, same for worker; keep both `build:` sections. `.env.example`: `# PORTFOLIO_VIEWER_VERSION=0.1.0` with a sentence on pinning.
- [ ] **Step 3: Verify** — `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest` exit 0; the version line run locally with `GITHUB_REF_NAME=v0.1.0` → exit 0 and with `v9.9.9` → exit 1; `docker compose config` in `deploy/` shows the GHCR names; `docker buildx build --platform linux/arm64 -f apps/worker/Dockerfile .` succeeds (the smaller image proves the base images and `npm ci` work on arm64); `docker compose up -d --build` still builds from source (the e2e in Task 3 runs on it).
- [ ] **Step 4: Commit** `ci: publish web and worker images to GHCR on release tags`.

### Task 3: Documentation and repository hygiene

**Files:**
- Modify: `README.md` (features, screenshots, quick start, links), `deploy/README.md` (published images or from source, versions and updates, backup and restore, reverse proxy, `SOURCE_URL`, TV and Android pointers), `docs/STATUS.md` (no local paths)
- Create: `CONTRIBUTING.md`, `SECURITY.md`, `docs/images/{dashboard,portfolio,tv}.png`
- Modify: `.gitignore` (`desktop.ini`, `.claude/settings.json`); remove `.claude/settings.json` from the index (the local copy moves to `.claude/settings.local.json`)

- [ ] **Step 1: Hygiene** — `git rm --cached .claude/settings.json`, move the file to `.claude/settings.local.json`; ignore `desktop.ini`; replace the two local paths in `docs/STATUS.md` with "kept outside the repository"; `docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --redact` → no leaks over the whole history.
- [ ] **Step 2: Backup and restore, tested** — on the demo stack with data: `docker compose exec -T db pg_dump -U postgres -d portfolio -Fc > backup.dump`; `docker compose down -v`; `docker compose up -d db`; `docker compose exec -T db pg_restore -U postgres -d portfolio --clean --if-exists < backup.dump`; `docker compose up -d`; sign in with the old account, the portfolio and its transactions are there. Write exactly these commands into the guide.
- [ ] **Step 3: Screenshots** — demo stack (`MARKET_DATA_PROVIDER=demo`), 1280 px dark: dashboard, portfolio page; TV 1920×1080 holdings; saved under `docs/images/`, each below 400 KB.
- [ ] **Step 4: Texts** — README: one-paragraph pitch, feature list (portfolios, transactions and CSV import, time-weighted returns vs. benchmarks, allocation, hypothetical chart, TV mode, Android app, English/German, multi-currency incl. pence), screenshots, quick start (clone, `.env`, `openssl rand`, `docker compose up -d`, first account is admin), links to the guide, CONTRIBUTING, SECURITY, license, "by JBP Capital". CONTRIBUTING: prerequisites (Node 24, Docker, JDK 21 + Android SDK for the app), `npm ci`, `npm run typecheck`, `npm test` (db tests need Docker), e2e against a demo stack (`E2E_RUN=$(date +%s) E2E_BASE_URL=http://localhost:3310`), English-only rule, tests with every change, commits in imperative mood, contributions under AGPL-3.0. SECURITY: supported version (latest release), report privately through GitHub's "Report a vulnerability" (Security tab), what to include, response time, no public issues for vulnerabilities.
- [ ] **Step 5: Newcomer run** — `git clone` the branch into the scratchpad, follow the README quick start word for word (with `--build`, as no image is published yet) on port 3320 with the demo provider; the first account becomes admin; tear it down.
- [ ] **Step 6: Commit** `docs: README, self-hosting guide, CONTRIBUTING and SECURITY for the open-source release`.

### Task 4: Docs, review, merge

- [ ] STATUS/PLAN (7 split: 7a done = preparation; 7b = owner's steps: make public, enable private vulnerability reporting, tag `v0.1.0`); full suite on a fresh stack; independent review; PR; merge.
