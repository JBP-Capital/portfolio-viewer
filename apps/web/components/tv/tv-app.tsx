'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { formatDate } from '../../lib/format.ts'
import { advance, buildScenes, pageCards, shownState, stepSeconds, tvKey, type TvState } from '../../lib/tv-nav.ts'
import { refreshWhenReachable, serverReachable } from '../../lib/tv-refresh.ts'
import type { TvSnapshot } from '../../lib/tv-snapshot.ts'
import { Byline } from '../brand.tsx'
import { DetailScene } from './detail.tsx'
import { AllocationScene, CardsScene, OverviewScene, PerformanceScene, TodayScene, type SceneProps } from './scenes.tsx'

declare global {
  interface Window {
    /** Called by the Android app on Back: true when the page used it (closed a detail or a mark). */
    pvTvBack?: () => boolean
  }
}

const REFRESH_MS = 5 * 60_000
/** After a key press the chosen screen stays this long before the rotation continues. */
const MANUAL_HOLD_MS = 60_000
/** A marked card or an open detail closes itself after this long without a key. */
const MARK_IDLE_MS = 5 * 60_000
const HINT_MS = 5000
const PRIVACY_KEY = 'pv-tv-privacy'

function readPrivacy(): boolean {
  try {
    return localStorage.getItem(PRIVACY_KEY) === 'true'
  } catch {
    return false
  }
}

function storePrivacy(on: boolean) {
  try {
    localStorage.setItem(PRIVACY_KEY, String(on))
  } catch {
    // Private windows may refuse storage; privacy then lasts until the page reloads.
  }
}

/** Base text size in px: about 20 px on a 1920 px wide screen, scaled with the width. */
const baseSize = () => Math.min(44, Math.max(12, window.innerWidth * 0.0105))

/** Full-screen, remote-controlled view of a member's portfolios; read-only. */
export function TvApp({ tv, locale, timeZone }: { tv: TvSnapshot; locale: string; timeZone: string }) {
  const t = useTranslations('tv')
  const app = useTranslations('app')
  const router = useRouter()
  const scenes = buildScenes(tv, {
    overview: t('scene_overview'),
    today: t('scene_today'),
    holdings: t('scene_holdings'),
    performance: t('scene_performance'),
    allocation: t('scene_allocation'),
  })
  const [state, setState] = useState<TvState>({ scene: 0, page: 0, paused: false, privacy: false, mark: null, detail: false })
  const [cycle, setCycle] = useState(0)
  // The running step: its length is fixed when it starts, so the progress bar and the timer agree.
  const [step, setStep] = useState({ id: 0, ms: 20_000 })
  const [hintVisible, setHintVisible] = useState(false)
  const [ready, setReady] = useState(false)
  const [fontSize, setFontSize] = useState(20)
  const scenesRef = useRef(scenes)
  scenesRef.current = scenes
  const stateRef = useRef(state)
  stateRef.current = state
  const holdUntil = useRef(0)
  const hintTimer = useRef(0)

  const showHint = (ms: number) => {
    setHintVisible(true)
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHintVisible(false), ms)
  }

  // Browser-only values: stored privacy choice, screen size; data reload while the server answers.
  useEffect(() => {
    setState((s) => ({ ...s, privacy: readPrivacy() }))
    setReady(true)
    showHint(2 * HINT_MS)
    const onResize = () => setFontSize(baseSize())
    onResize()
    window.addEventListener('resize', onResize)
    const refresh = window.setInterval(() => void refreshWhenReachable(serverReachable, () => router.refresh()), REFRESH_MS)
    return () => {
      window.removeEventListener('resize', onResize)
      window.clearInterval(refresh)
      window.clearTimeout(hintTimer.current)
    }
  }, [router])

  // The remote: the D-pad arrives as arrow keys, OK as Enter.
  useEffect(() => {
    const press = (key: string): boolean => {
      const current = stateRef.current
      const result = tvKey(current, key, scenesRef.current)
      if (!result.handled) return false
      if (result.state.privacy !== current.privacy) storePrivacy(result.state.privacy)
      stateRef.current = result.state
      setState(result.state)
      holdUntil.current = Date.now() + MANUAL_HOLD_MS
      showHint(HINT_MS)
      setCycle((c) => c + 1)
      return true
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (press(event.key)) event.preventDefault()
    }
    // The Android app asks before Back leaves the app, so Back first closes a detail or a mark.
    window.pvTvBack = () => press('Escape')
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      delete window.pvTvBack
    }
  }, [])

  // A refreshed snapshot can have fewer scenes, pages or cards.
  const shown = shownState(state, scenes)
  const sceneIndex = shown.scene
  const scene = scenes[sceneIndex]!
  const page = shown.page
  const pageIds = pageCards(scene, page)
  const marking = shown.mark !== null

  useEffect(() => {
    // A marked card holds the screen; the rotation continues once the mark is gone.
    if (state.paused || marking) return
    const current = scenesRef.current[Math.min(state.scene, scenesRef.current.length - 1)]!
    const ms = Math.max(stepSeconds(current) * 1000, holdUntil.current - Date.now())
    setStep((s) => ({ id: s.id + 1, ms }))
    const timer = window.setTimeout(() => {
      setState((s) => advance({ ...s, scene: Math.min(s.scene, scenesRef.current.length - 1) }, scenesRef.current))
      setCycle((c) => c + 1)
    }, ms)
    return () => window.clearTimeout(timer)
    // `cycle` restarts the step after every key, click and automatic change.
  }, [state.paused, state.scene, state.page, marking, cycle])

  useEffect(() => {
    if (!marking) return
    const timer = window.setTimeout(() => {
      setState((s) => ({ ...s, mark: null, detail: false }))
      setCycle((c) => c + 1)
    }, MARK_IDLE_MS)
    return () => window.clearTimeout(timer)
  }, [marking, cycle])

  const click = (next: Partial<TvState>) => {
    setState((s) => {
      const merged = { ...s, ...next }
      if (merged.privacy !== s.privacy) storePrivacy(merged.privacy)
      return merged
    })
    holdUntil.current = Date.now() + MANUAL_HOLD_MS
    setCycle((c) => c + 1)
  }

  const props: SceneProps = { tv, page, privacy: state.privacy, locale, tickSize: Math.round(fontSize * 0.8) }
  const portfolio = scene.portfolioId ? tv.portfolios.find((p) => p.id === scene.portfolioId) : undefined
  const cards = scene.kind === 'holdings' ? tv.holdings : (portfolio?.cards ?? [])
  const detail = shown.detail ? cards.find((c) => c.instrumentId === shown.mark?.card) : undefined
  const body = detail ? (
    <DetailScene {...props} card={detail} />
  ) : scene.kind === 'overview' ? (
    <OverviewScene {...props} />
  ) : scene.kind === 'today' ? (
    <TodayScene {...props} />
  ) : scene.kind === 'holdings' || scene.kind === 'portfolio' ? (
    <CardsScene {...props} cards={cards} mark={shown.mark ? pageIds.indexOf(shown.mark.card) : null} />
  ) : scene.kind === 'performance' ? (
    <PerformanceScene {...props} />
  ) : (
    <AllocationScene {...props} />
  )
  return (
    <div data-ready={ready} className="flex h-dvh w-full flex-col overflow-hidden bg-bg px-[2.4em] py-[1.4em] text-text" style={{ fontSize }}>
      <header className="flex items-center justify-between gap-[2em] pb-[1em]">
        <div className="flex items-center gap-[0.8em]">
          <span className="font-display text-[1.3em] font-bold tracking-tight">Portfolio Viewer</span>
          <Byline by={app('by')} size="h-[2.2em]" />
        </div>
        <h1 data-testid="tv-scene" className="font-display text-[1.6em] font-bold tracking-tight">
          {scene.title}
          {scene.pages > 1 ? <span className="ml-[0.5em] text-[0.7em] font-normal text-muted">{`${page + 1}/${scene.pages}`}</span> : null}
        </h1>
        <div className="flex items-center gap-[1em] text-[1.1em]">
          {state.privacy ? (
            <span data-testid="tv-private" className="bg-surface-high px-[0.6em] py-[0.2em] text-[0.8em] uppercase tracking-[0.12em] text-gold">
              {t('private')}
            </span>
          ) : null}
          {state.paused ? <span className="text-[0.8em] uppercase tracking-[0.12em] text-muted">{t('paused')}</span> : null}
          <Clock locale={locale} timeZone={timeZone} />
        </div>
      </header>

      <main key={`${scene.id}-${page}${detail ? '-detail' : ''}`} className="min-h-0 flex-1">
        {body}
      </main>

      <footer className="flex items-center justify-between gap-[1.5em] pt-[1em]">
        <nav className="flex min-w-0 flex-wrap gap-px bg-bg">
          {scenes.map((s, i) => (
            <button
              key={s.id}
              type="button"
              tabIndex={-1}
              onClick={() => click({ scene: i, page: 0, mark: null, detail: false })}
              className={`relative px-[0.9em] py-[0.5em] text-[0.8em] font-semibold uppercase tracking-[0.08em] ${
                i === sceneIndex ? 'bg-surface-highest text-gold' : 'bg-surface-high text-muted'
              }`}
            >
              {s.title}
              {i === sceneIndex && !state.paused && !marking ? (
                <span className="absolute inset-x-0 bottom-0 h-[0.15em] bg-surface-high">
                  <span key={step.id} className="tv-progress block h-full origin-left bg-gold" style={{ animationDuration: `${step.ms}ms` }} />
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-[0.6em] text-[0.8em] text-muted">
          <button type="button" tabIndex={-1} onClick={() => click({ paused: !state.paused })} className="bg-surface-high px-[0.9em] py-[0.5em]">
            {state.paused ? t('resume') : t('pause')}
          </button>
          <button type="button" tabIndex={-1} onClick={() => click({ privacy: !state.privacy })} className="bg-surface-high px-[0.9em] py-[0.5em]">
            {state.privacy ? t('showAmounts') : t('hideAmounts')}
          </button>
          <span>{t('pricesAsOf', { date: formatDate(tv.asOf, locale) })}</span>
        </div>
      </footer>

      <div
        aria-hidden={!hintVisible}
        className={`pointer-events-none fixed inset-x-0 bottom-[5em] mx-auto flex w-fit gap-[1.6em] bg-surface-highest px-[1.4em] py-[0.8em] text-[0.9em] shadow-lg transition-opacity duration-500 ${
          hintVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {detail ? (
          <span>
            <Key>OK</Key>
            <Key>{t('keyBack')}</Key> {t('keysClose')}
          </span>
        ) : marking ? (
          <>
            <span>
              <Key>◀ ▶ ▲ ▼</Key> {t('keysMove')}
            </span>
            <span>
              <Key>OK</Key> {t('keysDetails')}
            </span>
            <span>
              <Key>{t('keyBack')}</Key> {t('keysClose')}
            </span>
          </>
        ) : (
          <>
            <span>
              <Key>◀ ▶</Key> {t('keysViews')}
            </span>
            <span>
              <Key>▲ ▼</Key> {t('keysPages')}
            </span>
            <span>
              <Key>OK</Key> {state.paused ? t('resume') : pageIds.length > 0 ? t('keysSelect') : t('pause')}
            </span>
          </>
        )}
        <span>
          <Key>0</Key> {state.privacy ? t('showAmounts') : t('hideAmounts')}
        </span>
      </div>
    </div>
  )
}

/** Ticks on its own, so the scenes and charts do not re-render every second. */
function Clock({ locale, timeZone }: { locale: string; timeZone: string }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(timer)
  }, [])
  if (now === null) return null
  return <span className="tabular-nums">{new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-US', { timeZone, hour: '2-digit', minute: '2-digit' }).format(now)}</span>
}

function Key({ children }: { children: React.ReactNode }) {
  return <span className="mr-[0.4em] bg-surface-high px-[0.5em] py-[0.1em] font-semibold text-gold">{children}</span>
}
