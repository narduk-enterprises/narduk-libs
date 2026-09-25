import { describe, expect, it } from 'vitest'

import { declutter, majority, pickPeaks } from '../../src/marks/declutter.js'

import type {
  DeclutterBackgroundItem,
  DeclutterInput,
  DeclutterItem,
  DeclutterStats,
} from '../../src/marks/declutter.js'

// The dynamic-pins redesign (commit ec68714) replaced the old chip system
// (`kind: 'chip'`, `flip`, `label`, `more`, `width`, per-`tier` config, frame
// edges, exclusion rects) with plain circular dots (`kind: 'dot'`, `radius`).
// This module no longer knows about tiers, frames, chips, labels, or a
// "cluster" mark shape at all -- see the header comment in declutter.ts.
// `DECLUTTER_TIERS`, `clusterRadius`, and `chipWidth` are gone with them, and
// so are frame-edge/exclusion flip and label/tick placement: that behaviour
// now lives in the caller (`utils/map/markLayer.ts`, `utils/map/marks.ts`)
// and is covered by that file's own tests, not this one. What remains here
// is the generic geometry: same-layer absorption, primary-beats-secondary,
// background thinning, determinism, and scale.

// ---------- fixtures ----------

function makeItem(overrides: Partial<DeclutterItem> & { id: string }): DeclutterItem {
  return { layer: 'primary', priority: 0, radius: 6, x: 0, y: 0, ...overrides }
}

function makeInput(overrides: Partial<DeclutterInput> = {}): DeclutterInput {
  return { background: [], gap: 2, items: [], ...overrides }
}

// Deterministic PRNG (mulberry32) so the shuffle and scale fixtures are
// reproducible across runs without pulling in a dependency.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed)
  const copy = items.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const a = copy[i]
    const b = copy[j]
    if (a === undefined || b === undefined) continue
    copy[i] = b
    copy[j] = a
  }
  return copy
}

// ---------- merge: same-layer absorption ----------

describe('declutter merge', () => {
  it('absorbs an overlapping lower-priority item into the higher-priority lead, and leaves a clear runner-up alone', () => {
    const result = declutter(
      makeInput({
        gap: 2,
        items: [
          makeItem({ id: 'a1', priority: 200, radius: 6, x: 0, y: 0 }),
          // need = 6 + 6 + 2 = 14; distance 10 < 14 -> absorbed into a1
          makeItem({ id: 'a2', priority: 90, radius: 6, x: 10, y: 0 }),
          makeItem({ id: 'b1', priority: 100, radius: 6, x: 1000, y: 0 }),
          // need = 14; distance 20 -> stays its own dot
          makeItem({ id: 'b2', priority: 50, radius: 6, x: 1020, y: 0 }),
        ],
      }),
    )

    expect(result).toEqual({
      background: [],
      marks: [
        { absorbed: ['a2'], id: 'a1', kind: 'dot', radius: 6, x: 0, y: 0 },
        { absorbed: [], id: 'b1', kind: 'dot', radius: 6, x: 1000, y: 0 },
        { absorbed: [], id: 'b2', kind: 'dot', radius: 6, x: 1020, y: 0 },
      ],
    })
  })

  // A placed dot's own x/y never move once set (`mergeLayer` only ever
  // appends to `absorbedIds`), so a chain of absorptions folds every id
  // into the first-placed lead without ever averaging positions -- unlike
  // the old chip/cluster engine, which centred a cluster bubble on the mean
  // of its members' original positions.
  it("keeps the lead's original position through a chain of absorptions, with no centroid averaging", () => {
    const result = declutter(
      makeInput({
        gap: 2,
        items: [
          makeItem({ id: 'p1', priority: 300, radius: 6, x: 0, y: 0 }),
          // need = 14; distance 8 < 14 -> absorbed into p1
          makeItem({ id: 'p3', priority: 250, radius: 6, x: 8, y: 0 }),
          // need = 14; distance 4 < 14 -> absorbed into p1
          makeItem({ id: 'p2', priority: 200, radius: 6, x: 4, y: 0 }),
        ],
      }),
    )

    expect(result.marks).toEqual([
      { absorbed: ['p3', 'p2'], id: 'p1', kind: 'dot', radius: 6, x: 0, y: 0 },
    ])
  })
})

// ---------- primary beats secondary ----------

describe('declutter primary beats secondary', () => {
  it('folds an overlapping secondary node -- and anything it already absorbed -- into the primary lead, but leaves a non-overlapping secondary node in place', () => {
    const result = declutter(
      makeInput({
        gap: 2,
        items: [
          makeItem({ id: 'pr1', priority: 500, radius: 6, x: 0, y: 0, layer: 'primary' }),
          // sec2 and sec3 merge within the secondary layer first (need 14,
          // distance 4), keeping sec2's own position as the secondary lead.
          makeItem({ id: 'sec2', priority: 20, radius: 6, x: 10, y: 0, layer: 'secondary' }),
          makeItem({ id: 'sec3', priority: 10, radius: 6, x: 14, y: 0, layer: 'secondary' }),
          // Far enough from pr1 (distance 1000) that it's never absorbed --
          // there's no push-apart step, only fold-in-or-leave-alone.
          makeItem({ id: 'sec4', priority: 5, radius: 6, x: 1000, y: 0, layer: 'secondary' }),
        ],
      }),
    )

    // sec2 (with sec3 already folded in) sits at distance 10 from pr1;
    // need = pr1.r + sec2.r + gap = 6 + 6 + 2 = 14, so pr1 absorbs both.
    expect(result.marks).toEqual([
      { absorbed: ['sec2', 'sec3'], id: 'pr1', kind: 'dot', radius: 6, x: 0, y: 0 },
      { absorbed: [], id: 'sec4', kind: 'dot', radius: 6, x: 1000, y: 0 },
    ])
  })
})

// ---------- absorption reach follows the lead's own radius ----------

describe('declutter absorption reach', () => {
  // The old chip engine could fold a lower dot in from further away than a
  // simple circle-overlap test would allow, because the chip's rectangular
  // footprint reached past its dot. Plain dots have no such asymmetric
  // reach: absorption is a pure circle-overlap test, so a bigger lead
  // radius is what widens the reach now.
  it('a larger lead radius reaches further, folding in a lower-priority item a smaller lead would miss', () => {
    const bigLead = makeInput({
      gap: 2,
      items: [
        makeItem({ id: 'h1', priority: 300, radius: 20, x: 100, y: 100 }),
        // need = 20 + 6 + 2 = 28; distance 26 < 28 -> absorbed
        makeItem({ id: 'l1', priority: 150, radius: 6, x: 126, y: 100 }),
      ],
    })
    const smallLead = makeInput({
      gap: 2,
      items: [
        makeItem({ id: 'h1', priority: 300, radius: 6, x: 100, y: 100 }),
        // need = 6 + 6 + 2 = 14; distance 26 -> stays its own dot
        makeItem({ id: 'l1', priority: 150, radius: 6, x: 126, y: 100 }),
      ],
    })

    expect(declutter(bigLead).marks).toEqual([
      { absorbed: ['l1'], id: 'h1', kind: 'dot', radius: 20, x: 100, y: 100 },
    ])
    expect(declutter(smallLead).marks).toEqual([
      { absorbed: [], id: 'h1', kind: 'dot', radius: 6, x: 100, y: 100 },
      { absorbed: [], id: 'l1', kind: 'dot', radius: 6, x: 126, y: 100 },
    ])
  })
  // #933: the merge grid's cell size once assumed no radius above 24, so two
  // overlapping radius-30 discs two cells apart were never compared and
  // merging depended on where the pair sat on the grid.
  it('merges overlapping discs above the old 24 px radius cap wherever they sit on screen', () => {
    for (const offset of [0, 11, 23, 37, 49]) {
      const result = declutter(
        makeInput({
          gap: 2,
          items: [
            makeItem({ id: 'a', priority: 2, radius: 30, x: offset, y: 0 }),
            // need = 30 + 30 + 2 = 62; distance 52 -> absorbed
            makeItem({ id: 'b', priority: 1, radius: 30, x: offset + 52, y: 0 }),
          ],
        }),
      )
      expect(result.marks.map((mark) => [mark.id, mark.absorbed])).toEqual([['a', ['b']]])
    }
  })
})

// ---------- background ----------

describe('declutter background', () => {
  it('thins pips before voids, drops occupied and near-duplicate items', () => {
    const background: DeclutterBackgroundItem[] = [
      { id: 'p-blocked', kind: 'pip', x: 500, y: 500 }, // overlaps m1's dot circle
      { id: 'p-close-1', kind: 'pip', x: 100, y: 100 }, // kept
      { id: 'p-close-2', kind: 'pip', x: 105, y: 100 }, // within 9px of p-close-1 -> dropped
      { id: 'p-far', kind: 'pip', x: 300, y: 300 }, // kept
      { id: 'v-far', kind: 'void', x: 200, y: 200 }, // kept
    ]
    const result = declutter(
      makeInput({
        background,
        items: [makeItem({ id: 'm1', priority: 100, radius: 6, x: 500, y: 500 })],
      }),
    )

    expect(result).toEqual({
      background: [
        { id: 'p-close-1', kind: 'pip', x: 100, y: 100 },
        { id: 'p-far', kind: 'pip', x: 300, y: 300 },
        { id: 'v-far', kind: 'void', x: 200, y: 200 },
      ],
      marks: [{ absorbed: [], id: 'm1', kind: 'dot', radius: 6, x: 500, y: 500 }],
    })
  })
})

// ---------- determinism ----------

describe('declutter determinism', () => {
  function buildFixture(): DeclutterInput {
    return makeInput({
      background: [
        { id: 'd-bg1', kind: 'pip', x: 900, y: 100 },
        { id: 'd-bg2', kind: 'void', x: 900, y: 300 },
        { id: 'd-bg3', kind: 'pip', x: 901, y: 100 },
        { id: 'd-bg4', kind: 'pip', x: 50, y: 900 },
      ],
      items: [
        makeItem({ id: 'd-p1', priority: 900, radius: 7, x: 50, y: 50 }),
        makeItem({ id: 'd-p2', priority: 780, radius: 7, x: 54, y: 50 }),
        makeItem({ id: 'd-p3', priority: 400, radius: 7, x: 200, y: 50 }),
        makeItem({ id: 'd-p4', priority: 380, radius: 7, x: 205, y: 53 }),
        makeItem({ id: 'd-s1', priority: 300, radius: 7, x: 52, y: 48, layer: 'secondary' }),
        makeItem({ id: 'd-s2', priority: 150, radius: 7, x: 400, y: 400, layer: 'secondary' }),
        makeItem({ id: 'd-s3', priority: 140, radius: 7, x: 404, y: 400, layer: 'secondary' }),
        makeItem({ id: 'd-p5', priority: 100, radius: 7, x: 700, y: 700 }),
      ],
    })
  }

  it('produces deep-equal output for a shuffled items and background order', () => {
    const fixture = buildFixture()
    const baseline = declutter(fixture)

    const shuffledOnce = declutter({
      ...fixture,
      background: shuffled(fixture.background, 7),
      items: shuffled(fixture.items, 11),
    })
    const shuffledTwice = declutter({
      ...fixture,
      background: shuffled(fixture.background, 23),
      items: shuffled(fixture.items, 29),
    })

    expect(shuffledOnce).toEqual(baseline)
    expect(shuffledTwice).toEqual(baseline)
  })
})

// ---------- scale ----------

describe('declutter scale', () => {
  function buildScaleItems(count: number, frame: { h: number; w: number }): DeclutterItem[] {
    const rand = mulberry32(20260917)
    const items: DeclutterItem[] = []
    for (let i = 0; i < count; i++) {
      items.push({
        id: `s${i}`,
        layer: rand() < 0.5 ? 'primary' : 'secondary',
        priority: Math.floor(rand() * 1000),
        // Kept within MAX_MERGE_RADIUS (24) -- the spatial grid's cell size
        // assumes no circle is larger than that.
        radius: 4 + Math.floor(rand() * 16),
        x: rand() * frame.w,
        y: rand() * frame.h,
      })
    }
    return items
  }

  function buildScaleBackground(
    count: number,
    frame: { h: number; w: number },
  ): DeclutterBackgroundItem[] {
    const rand = mulberry32(20260918)
    const items: DeclutterBackgroundItem[] = []
    for (let i = 0; i < count; i++) {
      items.push({
        id: `bg${i}`,
        kind: rand() < 0.5 ? 'pip' : 'void',
        x: rand() * frame.w,
        y: rand() * frame.h,
      })
    }
    return items
  }

  it('handles 1,500 mixed-layer items in a 1440x844 frame within 200_000 pair-checks / 20_000 cell visits / 250_000 occupied-checks with no primary-layer overlap', () => {
    const frame = { h: 844, w: 1440 }
    const items = buildScaleItems(1500, frame)
    const background = buildScaleBackground(400, frame)
    const itemById = new Map(items.map((item) => [item.id, item]))
    const gap = 2

    // Measured 2026-09-18 on this seeded fixture (identical across runs):
    // pairChecks=159560, cellVisits=15381, occupiedChecks=197372.
    // Ceilings are those counts + ~25% headroom, rounded up.
    const SCALE_PAIR_CHECK_CEILING = 200_000
    const SCALE_CELL_VISIT_CEILING = 20_000
    const SCALE_OCCUPIED_CHECK_CEILING = 250_000

    const stats: DeclutterStats = { cellVisits: 0, occupiedChecks: 0, pairChecks: 0 }
    const start = performance.now()
    const result = declutter({ background, gap, items }, stats)
    const elapsedMs = performance.now() - start

    // Elapsed ms is information only — the required gate is the work counts.
    console.log(
      `declutter scale test: 1500 items + 400 background marks in ${elapsedMs.toFixed(2)}ms` +
        ` pairChecks=${stats.pairChecks} cellVisits=${stats.cellVisits}` +
        ` occupiedChecks=${stats.occupiedChecks}`,
    )
    expect(stats.pairChecks).toBeLessThanOrEqual(SCALE_PAIR_CHECK_CEILING)
    expect(stats.cellVisits).toBeLessThanOrEqual(SCALE_CELL_VISIT_CEILING)
    expect(stats.occupiedChecks).toBeLessThanOrEqual(SCALE_OCCUPIED_CHECK_CEILING)

    const primaryCircles = result.marks
      .map((mark) => ({
        layer: itemById.get(mark.id)?.layer,
        radius: mark.radius,
        x: mark.x,
        y: mark.y,
      }))
      .filter((entry) => entry.layer === 'primary')

    let violation: { distance: number; need: number } | null = null
    for (let i = 0; i < primaryCircles.length && violation === null; i++) {
      const a = primaryCircles[i]
      if (a === undefined) continue
      for (let j = i + 1; j < primaryCircles.length; j++) {
        const b = primaryCircles[j]
        if (b === undefined) continue
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        const need = a.radius + b.radius + gap - 0.5
        if (distance < need) {
          violation = { distance, need }
          break
        }
      }
    }

    expect(violation).toBeNull()
  })
})

// ---------- peaks and majority ----------

describe('pickPeaks', () => {
  it('keeps the strongest candidate in each spacing radius, strongest first', () => {
    const peaks = pickPeaks(
      [
        { id: 'weak', score: 1, x: 50, y: 0 },
        { id: 'strong', score: 9, x: 0, y: 0 },
        { id: 'edge', score: 2, x: 90, y: 0 }, // exactly `spacing` away: not crowded
        { id: 'inside', score: 5, x: 89, y: 0 }, // 89 px from strong: crowded
      ],
      90,
      18,
    )
    expect([...peaks].toSorted()).toEqual(['edge', 'strong'])
  })

  it('stops at the cap and breaks exact ties by id', () => {
    const row = Array.from({ length: 30 }, (_, index) => ({
      id: `p${String(index).padStart(2, '0')}`,
      score: 1,
      x: index * 100,
      y: 0,
    }))
    const peaks = pickPeaks(shuffled(row, 3), 90, 8)
    expect([...peaks]).toEqual(row.slice(0, 8).map((item) => item.id))
  })

  it('declutters and picks peaks for 1500 points inside 8 ms', () => {
    const rand = mulberry32(5)
    const items = Array.from({ length: 1500 }, (_, index) =>
      makeItem({
        id: `d${index}`,
        priority: 1500 - index,
        radius: 4 + rand() * 9,
        x: rand() * 1440,
        y: 200 + rand() * rand() * 700,
      }),
    )
    const pass = () => {
      pickPeaks(
        items.map((item) => ({ id: item.id, score: item.radius, x: item.x, y: item.y })),
        90,
        18,
      )
      return declutter(makeInput({ items }))
    }
    for (let i = 0; i < 10; i++) pass()
    const times: number[] = []
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      pass()
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    // ~2 ms locally. The fastest run carries the 8 ms budget and the median a
    // generous one, so a loaded CI runner passes while an O(n^2) regression
    // (tens of ms at this size) cannot.
    expect(times[0]).toBeLessThan(8)
    expect(times[10]).toBeLessThan(20)
  })

  it('never picks two peaks closer than the spacing on a dense field', () => {
    const rand = mulberry32(11)
    const field = Array.from({ length: 1500 }, (_, index) => ({
      id: `f${index}`,
      score: rand(),
      x: rand() * 1440,
      y: rand() * 900,
    }))
    const peaks = pickPeaks(field, 90, 1500)
    const chosen = field.filter((item) => peaks.has(item.id))
    const tooClose = chosen.flatMap((a) =>
      chosen.filter((b) => a !== b && Math.hypot(a.x - b.x, a.y - b.y) < 90),
    )
    expect(tooClose).toEqual([])
  })
})

describe('majority', () => {
  const severity = (state: string) => ['live', 'aging', 'stale', 'void'].indexOf(state)

  it('returns the most common value', () => {
    expect(majority(['live', 'stale', 'live'], severity)).toBe('live')
  })

  it('breaks a tie toward the worse value, whatever the order', () => {
    expect(majority(['aging', 'stale', 'stale', 'aging'], severity)).toBe('stale')
    expect(majority(['stale', 'aging', 'aging', 'stale'], severity)).toBe('stale')
    expect(majority(['live', 'void'], severity)).toBe('void')
  })

  it('has no majority of nothing', () => {
    expect(majority([], severity)).toBeUndefined()
  })
})
