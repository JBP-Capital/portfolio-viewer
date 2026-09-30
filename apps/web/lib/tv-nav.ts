import type { TvSnapshot } from './tv-snapshot.ts'

export const CARDS_PER_PAGE = 12
const SCENE_SECONDS = 20
const PAGE_SECONDS = 12

export interface TvScene {
  id: string
  kind: 'overview' | 'today' | 'holdings' | 'portfolio' | 'performance' | 'allocation'
  title: string
  pages: number
  /** Instrument ids of the security cards in their order, on card scenes. */
  cardIds?: string[]
  portfolioId?: string
}

/** A card marked with the remote: its security and the scene it was marked on. */
export interface TvMark {
  scene: string
  card: string
}

export interface TvState {
  scene: number
  page: number
  paused: boolean
  privacy: boolean
  mark: TvMark | null
  /** The marked card's detail is open. */
  detail: boolean
}

/** Keys a remote or keyboard sends for Back. */
const BACK_KEYS = new Set(['Escape', 'GoBack', 'BrowserBack'])

const cardPages = (count: number) => Math.max(1, Math.ceil(count / CARDS_PER_PAGE))

/** The scenes worth showing for this snapshot, in order; scenes without data are left out. */
export function buildScenes(
  tv: TvSnapshot,
  titles: { overview: string; today: string; holdings: string; performance: string; allocation: string },
): TvScene[] {
  const scenes: TvScene[] = [{ id: 'overview', kind: 'overview', title: titles.overview, pages: 1 }]
  if (tv.movers.up.length + tv.movers.down.length > 0) scenes.push({ id: 'today', kind: 'today', title: titles.today, pages: 1 })
  if (tv.holdings.length > 0) {
    const cardIds = tv.holdings.map((c) => c.instrumentId)
    scenes.push({ id: 'holdings', kind: 'holdings', title: titles.holdings, pages: cardPages(cardIds.length), cardIds })
  }
  for (const p of tv.portfolios) {
    if (p.cards.length > 0) {
      const cardIds = p.cards.map((c) => c.instrumentId)
      scenes.push({ id: `portfolio:${p.id}`, kind: 'portfolio', title: p.name, pages: cardPages(cardIds.length), cardIds, portfolioId: p.id })
    }
  }
  if (tv.performance.length > 0) scenes.push({ id: 'performance', kind: 'performance', title: titles.performance, pages: tv.performance.length })
  if (tv.allocation.some((a) => a.slices.length > 0)) scenes.push({ id: 'allocation', kind: 'allocation', title: titles.allocation, pages: 1 })
  return scenes
}

export function stepSeconds(scene: TvScene): number {
  return scene.pages > 1 ? PAGE_SECONDS : SCENE_SECONDS
}

const wrap = (index: number, count: number) => (index + count) % count

/** Instrument ids of the cards on one page of a scene; none on scenes without cards. */
export function pageCards(scene: TvScene | undefined, page: number): string[] {
  return (scene?.cardIds ?? []).slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE)
}

/**
 * The state as shown with the current snapshot, which can have fewer scenes, pages or cards than the
 * one the state was made on: a mark stays only while its security is in its scene, on the page that
 * now holds it.
 */
export function shownState(state: TvState, scenes: TvScene[]): TvState {
  const sceneIndex = Math.min(state.scene, scenes.length - 1)
  const scene = scenes[sceneIndex]!
  const index = state.mark !== null && state.mark.scene === scene.id ? (scene.cardIds ?? []).indexOf(state.mark.card) : -1
  if (index < 0) return { ...state, scene: sceneIndex, page: Math.min(state.page, scene.pages - 1), mark: null, detail: false }
  return { ...state, scene: sceneIndex, page: Math.floor(index / CARDS_PER_PAGE) }
}

/** Keys while a card is marked or its detail is open; null for keys that act as without a mark. */
function markKey(state: TvState, key: string, ids: string[], index: number): TvState | null {
  const [columns] = gridShape(ids.length)
  const moveTo = (to: number): TvState => ({ ...state, mark: { ...state.mark!, card: ids[to]! } })
  if (state.detail) {
    // OK returns to the marked card, Back to the running scene.
    if (key === 'Enter' || key === ' ') return { ...state, detail: false }
    if (BACK_KEYS.has(key)) return { ...state, mark: null, detail: false }
    // The arrows wait until the detail is closed.
    return key.startsWith('Arrow') ? state : null
  }
  switch (key) {
    case 'Enter':
    case ' ':
      return { ...state, detail: true }
    case 'ArrowLeft':
      return moveTo(Math.max(0, index - 1))
    case 'ArrowRight':
      return moveTo(Math.min(ids.length - 1, index + 1))
    case 'ArrowUp':
      return index < columns ? { ...state, mark: null } : moveTo(index - columns)
    case 'ArrowDown':
      return moveTo(index + columns < ids.length ? index + columns : index)
    default:
      return BACK_KEYS.has(key) ? { ...state, mark: null } : null
  }
}

/** One step of the automatic rotation: the next page, or the next scene after the last page. */
export function advance(current: TvState, scenes: TvScene[]): TvState {
  const state: TvState = { ...current, mark: null, detail: false }
  const pages = scenes[state.scene]?.pages ?? 1
  return state.page + 1 < pages ? { ...state, page: state.page + 1 } : { ...state, scene: wrap(state.scene + 1, scenes.length), page: 0 }
}

/** A remote-control key (D-pad, OK, digits, media keys) applied to the TV state. */
export function tvKey(current: TvState, key: string, scenes: TvScene[]): { state: TvState; handled: boolean } {
  const shown = shownState(current, scenes)
  const ids = pageCards(scenes[shown.scene], shown.page)
  if (shown.mark !== null && key !== '0') {
    const next = markKey(shown, key, ids, ids.indexOf(shown.mark.card))
    if (next) return { state: next, handled: true }
  }
  // Any other key leaves the mark.
  const state: TvState = key === '0' ? shown : { ...shown, mark: null, detail: false }
  const count = scenes.length
  const scene = (index: number, page = 0): TvState => ({ ...state, scene: wrap(index, count), page })
  switch (key) {
    case 'ArrowRight':
    case 'MediaTrackNext':
    case 'MediaFastForward':
      return { state: scene(state.scene + 1), handled: true }
    case 'ArrowLeft':
    case 'MediaTrackPrevious':
    case 'MediaRewind':
      return { state: scene(state.scene - 1), handled: true }
    case 'ArrowDown':
      return { state: advance(state, scenes), handled: true }
    case 'ArrowUp': {
      if (state.page > 0) return { state: { ...state, page: state.page - 1 }, handled: true }
      const previous = wrap(state.scene - 1, count)
      return { state: scene(previous, (scenes[previous]?.pages ?? 1) - 1), handled: true }
    }
    case 'Enter':
    case ' ':
      // On card scenes OK marks the first card; elsewhere, and on a paused screen, it acts as the play key.
      if (ids.length > 0 && !state.paused) return { state: { ...state, mark: { scene: scenes[state.scene]!.id, card: ids[0]! } }, handled: true }
      return { state: { ...state, paused: !state.paused }, handled: true }
    case 'MediaPlayPause':
      return { state: { ...state, paused: !state.paused }, handled: true }
    case 'MediaPlay':
      return { state: { ...state, paused: false }, handled: true }
    case 'MediaPause':
      return { state: { ...state, paused: true }, handled: true }
    case '0':
      return { state: { ...state, privacy: !state.privacy }, handled: true }
    default:
      if (/^[1-9]$/.test(key) && Number(key) <= count) return { state: scene(Number(key) - 1), handled: true }
      return { state: current, handled: false }
  }
}

/** Columns and rows for the cards of one page: few cards get more room, at most 4 × 3. */
export function gridShape(count: number): [columns: number, rows: number] {
  if (count <= 1) return [1, 1]
  if (count <= 2) return [2, 1]
  if (count <= 4) return [2, 2]
  if (count <= 6) return [3, 2]
  if (count <= 9) return [3, 3]
  return [4, 3]
}
