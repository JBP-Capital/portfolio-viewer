import { describe, expect, it } from 'vitest'
import { advance, buildScenes, CARDS_PER_PAGE, gridShape, shownState, stepSeconds, tvKey, type TvScene, type TvState } from '../lib/tv-nav.ts'
import type { TvCard, TvSnapshot } from '../lib/tv-snapshot.ts'

const card = (i: number): TvCard => ({
  instrumentId: `i${i}`, listingId: `l${i}`, name: `N${i}`, symbol: `S${i}`, quantity: 1, currency: 'EUR', price: 1, value: 1, dayChange: 0.1,
  dayChangePct: 0.1, unrealizedGain: null, unrealizedPct: null,
})
const totals = { value: 0, costOfPriced: 0, unrealizedGain: 0, dayChange: 0, realizedGain: 0, dividendsNet: 0, unpriced: 0, totalReturn: 0 }

function snapshot(values: Partial<TvSnapshot> = {}): TvSnapshot {
  return {
    baseCurrency: 'EUR', asOf: '2026-09-28', memberName: null, totals, holdings: [], portfolios: [], value1Y: [], performance: [], prices: {},
    allocation: [{ by: 'sector', slices: [] }, { by: 'currency', slices: [] }, { by: 'country', slices: [] }], movers: { up: [], down: [] },
    ...values,
  }
}

const titles = { overview: 'Overview', today: 'Today', holdings: 'Holdings', performance: 'Performance', allocation: 'Allocation' }

describe('buildScenes', () => {
  it('shows only the overview for a member without holdings', () => {
    expect(buildScenes(snapshot(), titles).map((s) => s.id)).toEqual(['overview'])
  })

  it('pages cards by twelve and gives every portfolio with holdings its own scene', () => {
    const holdings = Array.from({ length: CARDS_PER_PAGE + 1 }, (_, i) => card(i))
    const scenes = buildScenes(
      snapshot({
        holdings,
        movers: { up: [card(1)], down: [] },
        portfolios: [
          { id: 'p1', name: 'Main', value: 1, dayChange: 0, cards: holdings },
          { id: 'p2', name: 'Empty', value: 0, dayChange: 0, cards: [] },
        ],
        performance: [{ range: '1M', view: {} as never }, { range: '6M', view: {} as never }],
        allocation: [{ by: 'sector', slices: [{ label: 'Tech', share: 1, value: 1 }] }, { by: 'currency', slices: [] }, { by: 'country', slices: [] }],
      }),
      titles,
    )
    expect(scenes.map((s) => [s.id, s.title, s.pages])).toEqual([
      ['overview', 'Overview', 1],
      ['today', 'Today', 1],
      ['holdings', 'Holdings', 2],
      ['portfolio:p1', 'Main', 2],
      ['performance', 'Performance', 2],
      ['allocation', 'Allocation', 1],
    ])
    expect(scenes.map((s) => s.cardIds?.length ?? 0)).toEqual([0, 0, CARDS_PER_PAGE + 1, CARDS_PER_PAGE + 1, 0, 0])
    expect(scenes[2]!.cardIds!.slice(0, 2)).toEqual(['i0', 'i1'])
  })
})

const ids = (count: number) => Array.from({ length: count }, (_, i) => `c${i}`)
const scenes: TvScene[] = [
  { id: 'a', kind: 'overview', title: 'A', pages: 1 },
  // 30 cards: two full pages of 4 × 3 and a last page of 6 in 3 × 2.
  { id: 'b', kind: 'holdings', title: 'B', pages: 3, cardIds: ids(30) },
  { id: 'c', kind: 'allocation', title: 'C', pages: 1 },
]
const at = (scene: number, page = 0, values: Partial<TvState> = {}): TvState => ({ scene, page, paused: false, privacy: false, mark: null, detail: false, ...values })
/** Card `index` of `page` on scene b marked. */
const marked = (index: number, page = 0, detail = false) => at(1, page, { mark: { scene: 'b', card: `c${page * CARDS_PER_PAGE + index}` }, detail })

describe('tvKey', () => {
  it('moves between scenes with ◀ ▶ and wraps around', () => {
    expect(tvKey(at(0), 'ArrowRight', scenes)).toEqual({ state: at(1), handled: true })
    expect(tvKey(at(2), 'ArrowRight', scenes).state).toEqual(at(0))
    expect(tvKey(at(0), 'ArrowLeft', scenes).state).toEqual(at(2))
    expect(tvKey(at(1, 2), 'MediaTrackNext', scenes).state).toEqual(at(2))
  })

  it('moves through pages with ▲ ▼, into the next or previous scene at the ends', () => {
    expect(tvKey(at(1, 0), 'ArrowDown', scenes).state).toEqual(at(1, 1))
    expect(tvKey(at(1, 2), 'ArrowDown', scenes).state).toEqual(at(2, 0))
    expect(tvKey(at(1, 1), 'ArrowUp', scenes).state).toEqual(at(1, 0))
    expect(tvKey(at(2, 0), 'ArrowUp', scenes).state).toEqual(at(1, 2))
  })

  it('pauses with OK outside card scenes, hides amounts with 0 and jumps with digits', () => {
    expect(tvKey(at(0), 'Enter', scenes).state.paused).toBe(true)
    expect(tvKey(at(0, 0, { paused: true }), ' ', scenes).state.paused).toBe(false)
    expect(tvKey(at(0), 'MediaPause', scenes).state.paused).toBe(true)
    expect(tvKey(at(0), '0', scenes).state.privacy).toBe(true)
    expect(tvKey(at(0), '3', scenes).state).toEqual(at(2))
    expect(tvKey(at(0), '4', scenes)).toEqual({ state: at(0), handled: false })
    expect(tvKey(at(0), 'x', scenes)).toEqual({ state: at(0), handled: false })
    expect(tvKey(at(0), 'Escape', scenes)).toEqual({ state: at(0), handled: false })
  })

  it('marks the first card of the page with OK on a card scene; the play key still pauses', () => {
    expect(tvKey(at(1, 2), 'Enter', scenes)).toEqual({ state: marked(0, 2), handled: true })
    expect(tvKey(at(1), 'MediaPlayPause', scenes).state).toEqual(at(1, 0, { paused: true }))
    // A paused screen resumes with OK first, on card scenes too.
    expect(tvKey(at(1, 0, { paused: true }), 'Enter', scenes).state).toEqual(at(1))
  })

  it('moves the mark within the page grid, and ▲ from the top row removes it', () => {
    // Page 0: 12 cards in 4 columns.
    expect(tvKey(marked(0), 'ArrowRight', scenes).state).toEqual(marked(1))
    expect(tvKey(marked(1), 'ArrowDown', scenes).state).toEqual(marked(5))
    expect(tvKey(marked(5), 'ArrowUp', scenes).state).toEqual(marked(1))
    expect(tvKey(marked(4), 'ArrowLeft', scenes).state).toEqual(marked(3))
    expect(tvKey(marked(1), 'ArrowUp', scenes)).toEqual({ state: at(1), handled: true })
    // At the edges the mark stays.
    expect(tvKey(marked(0), 'ArrowLeft', scenes).state).toEqual(marked(0))
    expect(tvKey(marked(11), 'ArrowRight', scenes).state).toEqual(marked(11))
    expect(tvKey(marked(9), 'ArrowDown', scenes).state).toEqual(marked(9))
    // Page 2: 6 cards in 3 columns.
    expect(tvKey(marked(2, 2), 'ArrowDown', scenes).state).toEqual(marked(5, 2))
    expect(tvKey(marked(4, 2), 'ArrowDown', scenes).state).toEqual(marked(4, 2))
  })

  it('opens the detail with OK; OK returns to the marked card, Back to the running scene', () => {
    expect(tvKey(marked(3), 'Enter', scenes).state).toEqual(marked(3, 0, true))
    expect(tvKey(marked(3, 0, true), 'Enter', scenes).state).toEqual(marked(3))
    expect(tvKey(marked(3, 0, true), 'Escape', scenes)).toEqual({ state: at(1), handled: true })
    expect(tvKey(marked(3), 'Escape', scenes)).toEqual({ state: at(1), handled: true })
    expect(tvKey(marked(3), 'GoBack', scenes).state).toEqual(at(1))
    // Arrows wait while the detail is open; 0 still hides the amounts.
    expect(tvKey(marked(3, 0, true), 'ArrowRight', scenes)).toEqual({ state: marked(3, 0, true), handled: true })
    expect(tvKey(marked(3, 0, true), '0', scenes).state).toEqual({ ...marked(3, 0, true), privacy: true })
  })

  it('keeps the mark on its security when a refresh reorders or shortens the cards', () => {
    const open = marked(0, 1, true)
    // After the refresh the marked security is the first of twelve cards on a single page.
    const shorter: TvScene[] = [scenes[0]!, { ...scenes[1]!, pages: 1, cardIds: ['c12', ...ids(11)] }, scenes[2]!]
    expect(shownState(open, shorter)).toEqual(at(1, 0, { mark: { scene: 'b', card: 'c12' }, detail: true }))
    expect(tvKey(open, 'Escape', shorter)).toEqual({ state: at(1), handled: true })
  })

  it('drops the mark when its security or its scene is gone', () => {
    const open = marked(0, 1, true)
    const sold: TvScene[] = [scenes[0]!, { ...scenes[1]!, pages: 1, cardIds: ids(12) }, scenes[2]!]
    expect(shownState(open, sold)).toEqual(at(1))
    expect(tvKey(open, 'Escape', sold)).toEqual({ state: open, handled: false })
    // Another scene now sits at the same position and shows the same security.
    const shifted: TvScene[] = [scenes[0]!, { ...scenes[1]!, id: 'portfolio:p' }, scenes[2]!]
    expect(shownState(open, shifted).mark).toBeNull()
  })

  it('leaves the mark when digits or media keys change the scene', () => {
    expect(tvKey(marked(2), '3', scenes).state).toEqual(at(2))
    expect(tvKey(marked(2, 0, true), 'MediaTrackNext', scenes).state).toEqual(at(2))
    expect(tvKey(marked(2), 'MediaPause', scenes).state).toEqual(at(1, 0, { paused: true }))
  })
})

describe('rotation', () => {
  it('shows pages for 12 seconds, other scenes for 20, and walks page by page', () => {
    expect(stepSeconds(scenes[1]!)).toBe(12)
    expect(stepSeconds(scenes[0]!)).toBe(20)
    expect(advance(at(1, 1), scenes)).toEqual(at(1, 2))
    expect(advance(at(1, 2), scenes)).toEqual(at(2, 0))
    expect(advance(at(2, 0), scenes)).toEqual(at(0, 0))
    expect(advance(marked(2), scenes)).toEqual(at(1, 1))
  })
})

describe('gridShape', () => {
  it('gives few cards more room and never more than 4 × 3', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 9, 10, 12].map(gridShape)).toEqual([
      [1, 1], [2, 1], [2, 2], [2, 2], [3, 2], [3, 2], [3, 3], [3, 3], [4, 3], [4, 3],
    ])
  })
})
