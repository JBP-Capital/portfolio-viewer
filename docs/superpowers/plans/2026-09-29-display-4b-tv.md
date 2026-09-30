# Display (sub-project 4b) — TV Mode and Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TV (Android TV app, smart-TV browser, projector) shows a member's portfolios in rotating full-screen scenes without anyone typing a password on the TV: the TV shows a 6-character code, the member enters it on `/pair` from a phone, and the TV receives a read-only device token that the member can revoke in settings.

**Architecture:** `packages/db/src/devices.ts` owns pairing codes and devices (tokens and poll secrets stored as SHA-256 only). `/api/tv/pairing` (POST start, GET poll) is the TV's only unauthenticated entry; it sets the `pv-pair` cookie while waiting and the `pv-tv` cookie once paired. `/tv` is a server component: with a valid device cookie it loads the member's data (same repositories as the dashboard, so numbers agree) and renders a client `TvApp`; otherwise it renders the pairing screen. The TV reloads its data with `router.refresh()` every 5 minutes.

**Tech Stack:** as before. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-26-portfolio-viewer-design.md` §3 (TV pairing), §7 (`/tv`, `/pair`, settings: TV devices), §10 (TV tokens: 32 random bytes, SHA-256, httpOnly cookie, read-only). Model: the family app's projector view — scenes, D-pad keys, privacy key `0`, footer navigation with progress bar, key hints.

## Design decisions

- **Code alphabet** `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O, 1/I): 32^6 ≈ 1.07 billion codes; valid 10 minutes; entry is case-insensitive and ignores spaces and dashes. Shown as `ABC-DEF`.
- **Two secrets:** the code only links a device to a member; the token is handed out only to the browser that holds the pairing's poll secret (`pv-pair` cookie, httpOnly), so someone who reads the code off the screen cannot take the token.
- **Brute force:** 10 failed claims per member per 15 minutes (reusing `login_attempts` with the key `pairing:<memberId>`); codes expire after 10 minutes; expired codes are deleted whenever a new one is created.
- **Device token:** 32 random bytes, base64url, cookie `pv-tv` (httpOnly, SameSite=Lax, Secure over HTTPS, 400 days). `last_seen_at` is updated at most every 10 minutes. Revoking deletes the device row; the TV falls back to the pairing screen on its next refresh.
- **Read-only:** device access exists only in `/tv` (page) — no route handler or server action accepts a device token for writing.
- **Scenes (generalized from the family app):** Overview (total, today, total return, 1Y value chart), Today (movers and every holding's day change), Holdings (cards, 12 per page, all portfolios merged), one scene per portfolio (cards, paged), Performance (one page per range 1M / 6M / 1Y / 5Y: comparison chart and returns), Allocation (sector, currency, exchange country). Scenes without data are left out.
- **Keys:** ◀ ▶ scene, ▲ ▼ page, OK/Space pause, `0` privacy (money hidden, percentages stay), `1`–`9` jump to scene, media keys next/previous/play/pause. Clicks and taps work on the footer buttons. After a manual change the scene holds 60 seconds before rotation continues.
- **Stock detail on the TV** (select a card, open its chart) is left for 4c.

## Global Constraints

- English in the repository, German only in `de.json`; every string in both message files.
- TV type is readable from 3 metres: body ≥ 20 px at 1920 px width, key figures ≥ 64 px; layout fills 16:9 without scrolling; works from 1280×720 to 3840×2160.
- Same numbers as the dashboard: the TV uses `valueMember`, `memberSeries`, `buildPerformance`, `allocation`.

## Review Focus

- A device of member A must never show member B's data, and a revoked device must stop showing data on its next load → db + e2e tests.
- The code seen on the screen alone must not yield a token (poll secret required) → db test.
- A token is issued exactly once; the stored values are hashes only → db test.
- A code cannot be claimed after 10 minutes or twice → db tests.
- The TV page must not break when the member has no portfolios or no prices yet.

---

### Task 1: Pairing codes and devices (db)

**Files:** `packages/db/src/schema.ts` (+ migration 0008), create `packages/db/src/devices.ts`, `packages/db/src/index.ts`, `packages/db/test/helpers.ts` (truncate), test `packages/db/test/devices.test.ts`.

**Interfaces — produces:**
```ts
export const tvDevices = pgTable('tv_devices', { id uuid pk, memberId uuid → members cascade, name text, tokenHash text unique nullable, createdAt, lastSeenAt timestamptz nullable })
export const pairingCodes = pgTable('pairing_codes', { code char(6) pk, pollSecretHash text notNull unique, expiresAt timestamptz notNull, deviceId uuid → tv_devices cascade nullable, createdAt })
export const PAIRING_MINUTES = 10
export function normalizePairingCode(input: string): string | null          // 'abc-def' → 'ABCDEF'; null when not 6 alphabet characters
export function startPairing(db, now?): Promise<{ code: string; pollSecret: string; expiresAt: Date }>
export type PairingPoll = { status: 'waiting'; code: string; expiresAt: Date } | { status: 'paired'; token: string } | { status: 'expired' }
export function pollPairing(db, pollSecret: string, now?): Promise<PairingPoll>   // 'paired' once: creates the token, stores its hash, deletes the code
export function claimPairing(db, memberId, rawCode: string, rawName: unknown, now?): Promise<TvDevice>  // NotFoundError('Pairing code') for unknown/expired/claimed; ValidationError for the name (1–40 chars); throttled → ThrottledError
export function deviceByToken(db, token: string, now?): Promise<{ deviceId: string; memberId: string } | null>
export function listDevices(db, memberId): Promise<TvDevice[]>                 // paired devices only, newest first
export function revokeDevice(db, memberId, deviceId): Promise<void>             // NotFoundError for a foreign or unknown device
```
- [ ] Tests first: code format and normalization; start → poll 'waiting' with the code; claim → poll returns 'paired' with a token once, a second poll is 'expired' (code gone); `deviceByToken(token)` → the member; the stored `token_hash` and `poll_secret_hash` are not the raw values; an unknown poll secret → 'expired'; claim after 10 minutes → NotFoundError; claiming a claimed code → NotFoundError; the 11th failed claim within 15 minutes → ThrottledError even for a valid code; member B cannot revoke or list A's device; revoke → `deviceByToken` null; deleting the member deletes its devices; `lastSeenAt` is written on first use and not again within 10 minutes. Implement, migration, verify, commit `feat(db): TV pairing codes and read-only devices`.

### Task 2: Pairing routes, `/pair`, settings

**Files:** create `apps/web/app/api/tv/pairing/route.ts`, `apps/web/lib/auth/device.ts` (`getDevice()`, cookie names/options), `apps/web/app/pair/page.tsx` + `actions.ts`, `apps/web/components/tv/pairing-screen.tsx` (client), modify `apps/web/app/settings/page.tsx` (+ actions: revoke), messages (`pair`, `tv`, `settings.devices*`); tests `apps/web/test/device-cookie.test.ts` (cookie options: httpOnly, secure only over HTTPS, max-age).

- `POST /api/tv/pairing` → `{ code, expiresAt }`, sets `pv-pair` (httpOnly, 10 min). `GET` → `{ status, code?, expiresAt? }`; on `paired` sets `pv-tv`, clears `pv-pair`. Both respond `Cache-Control: no-store`.
- `/pair` (member): code field (large, uppercase, `autocomplete=off`, `inputmode=text`), device name (default "TV"), result message; errors: unknown or expired code, too many attempts.
- Settings: "TV devices" list (name, paired on, last seen) with Remove (confirm).
- Pairing screen: logo, "Open <origin>/pair on your phone and enter" + code in 96 px letters, expiry countdown, polls every 3 s, starts a new code when expired, reloads when paired.
- [ ] Tests first for the cookie helper; implement; typecheck, build; commit `feat(web): pair a TV with a code, list and remove TV devices`.

### Task 3: TV snapshot (pure) and loader

**Files:** create `apps/web/lib/tv-snapshot.ts` (pure `buildTvSnapshot`), `apps/web/lib/tv-data.ts` (loads through the repositories for a member id), test `apps/web/test/tv-snapshot.test.ts`.

**Interfaces:**
```ts
export interface TvCard { instrumentId: string; name: string; symbol: string; quantity: number; value: number | null; dayChange: number | null; dayChangePct: number | null; price: number | null; currency: string }
export interface TvSnapshot {
  baseCurrency: string; asOf: string; memberName: string | null
  totals: Valuation['totals']
  holdings: TvCard[]                                   // merged, by value
  portfolios: { id: string; name: string; value: number; dayChange: number; cards: TvCard[] }[]
  value1Y: ChartPoint[]
  performance: { range: '1M' | '6M' | '1Y' | '5Y'; view: PerformanceView }[]
  allocation: { by: 'sector' | 'currency' | 'country'; slices: { label: string; share: number; value: number }[] }[]
  movers: { up: TvCard[]; down: TvCard[] }
}
export function buildTvSnapshot(input: { total: MemberValuation; names: Map<string, string>; series: SeriesResult; labels: {...}; memberName: string | null }): TvSnapshot
```
- [ ] Tests first: cards sorted by value; day change percent from value and day change (null without price); portfolios in list order with their names; performance pages only for ranges with data; empty member → holdings [] and no performance pages (no throw); movers top 3 each way. Implement; commit `feat(web): TV snapshot from the dashboard repositories`.

### Task 4: TV app

**Files:** `apps/web/app/tv/page.tsx`, `apps/web/app/tv/layout.tsx` (no app shell, black page, `viewport` fixed), `apps/web/components/tv/tv-app.tsx` (client), `apps/web/components/tv/scenes.tsx`, `apps/web/lib/tv-nav.ts` (pure: scene list, `tvKey(state, key, scenes)` → next state), test `apps/web/test/tv-nav.test.ts`.

- `tvKey` covers: ◀ ▶ wrap around, ▲ ▼ within pages (▼ on the last page goes to the next scene), OK/Space toggles pause, `0` privacy, digits jump (ignored past the scene count), media keys; unknown keys → unchanged + `handled: false`.
- Rotation: 20 s per scene, 12 s per page on paged scenes, 60 s hold after a manual change; progress bar in the active footer item; clock (member time zone) and privacy badge in the header; key hint overlay for 5 s after each key; `router.refresh()` every 5 minutes; the scene area never scrolls (content that does not fit is paged).
- Privacy: money values render as "•••" through one formatter; percentages and share counts stay.
- [ ] Tests first for `tvKey` and scene list building (scenes without data dropped); implement; screenshots at 1920×1080 and 1280×720 (dark); commit `feat(web): TV mode with rotating scenes, remote keys and privacy`.

### Task 5: End-to-end and docs

**Files:** `apps/web/e2e/07-tv.spec.ts`; `docs/STATUS.md`, `docs/PLAN.md`.

- [ ] e2e with two browser contexts: the TV context opens `/tv` and sees a code; the member context signs in, opens `/pair`, enters the code in lower case with a dash and a name; the TV context shows the Overview scene with the total within 10 s; `ArrowRight` changes the scene title; `0` shows the privacy badge and hides the euro total; settings lists the device, Remove → the TV context shows a pairing code again after reload; a wrong code on `/pair` shows the error. Full suite on a fresh stack; STATUS with evidence; PLAN (4b ticked). Commit `test(e2e): TV pairing and TV mode`.
