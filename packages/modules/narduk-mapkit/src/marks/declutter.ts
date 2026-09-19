/**
 * Framework-free point-map declutter engine: greedily places same-layer
 * circles largest-first, folding anything a placed circle overlaps into that
 * circle's `absorbed` id list instead of drawing it, lets a primary layer
 * absorb an overlapping secondary layer the same way, and thins a background
 * layer of context marks clear of what got placed. No DOM, no Vue/Nuxt, no
 * domain vocabulary -- the caller supplies already-projected pixel positions
 * (and each item's own radius) and reads back pixel layout.
 *
 * Ported from the site-redesign-v2 prototype (`Main.dc.html`/`Mobile.dc.html`
 * `layout()`): sort by rank then radius, walk the sorted list once, and fold
 * an item into the first already-placed circle it overlaps. The prototype's
 * placement loop is O(n^2) (it rescans every placed circle for every
 * candidate) and its tie-breaks fall out of incidental array order; this
 * port is deterministic by construction and finds the first overlap through
 * a uniform spatial grid, so it stays fast at map-sized input counts. Two
 * rules the prototype left implicit are made explicit here:
 *
 *   1. Every priority comparison breaks an exact tie by ascending id
 *      (`comparePriority`), so the result never depends on input order.
 *   2. Every id list the engine returns (`absorbed`) is sorted by that same
 *      rule, and so is the final `marks` array.
 *
 * There is no cluster shape in this engine any more: v2 has no chip boxes
 * and no centroid-merged cluster bubble. A caller that wants the "cell hides
 * a lot of stations" fallback the boards describe reads it straight off
 * `DeclutterDot.absorbed.length` -- that is a rendering choice, not a layout
 * one, so it belongs in the caller's own domain code, not here.
 */

export interface DeclutterItem {
  id: string
  /** Absorbs an overlapping item from the other layer when they touch. */
  layer: 'primary' | 'secondary'
  priority: number
  /** Pixel radius the caller will render this item at, and the merge test uses. */
  radius: number
  x: number
  y: number
}

export interface DeclutterBackgroundItem {
  id: string
  kind: 'pip' | 'void'
  x: number
  y: number
}

export interface DeclutterInput {
  /** Context marks (no reading on this lens); thinned clear of what got placed. */
  background: readonly DeclutterBackgroundItem[]
  /** Minimum clearance, in pixels, kept between two placed circles' edges. */
  gap: number
  items: readonly DeclutterItem[]
}

export interface DeclutterDot {
  absorbed: string[]
  id: string
  kind: 'dot'
  radius: number
  x: number
  y: number
}

export interface DeclutterResult {
  background: DeclutterBackgroundItem[]
  marks: DeclutterDot[]
}

/**
 * Optional diagnostic counters for inner-loop work. Pass an object of zeroes
 * to accumulate; omit it (the production path) so every increment is skipped.
 * Callers own the object — this module never allocates one.
 */
export interface DeclutterStats {
  /** Spatial-grid cell lookups (9 per neighbourhood query). */
  cellVisits: number
  /** Occupied-rect overlap tests while thinning background. */
  occupiedChecks: number
  /** Distance comparisons in mergeLayer, resolveLayers, and background proximity. */
  pairChecks: number
}

// ---------- shared geometry ----------

interface Rect {
  h: number
  w: number
  x: number
  y: number
}

function rectsOverlap(a: Rect, b: Rect, pad: number): boolean {
  return (
    a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad
  )
}

function circleRect(x: number, y: number, r: number): Rect {
  return { h: r * 2, w: r * 2, x: x - r, y: y - r }
}

// ---------- determinism ----------

interface PrioritizedId {
  id: string
  priority: number
}

// Priority desc, then id asc -- the single tie-break rule every ordering
// decision in this module funnels through, so output never depends on the
// order items arrived in.
function comparePriority(a: PrioritizedId, b: PrioritizedId): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

function requireItem(itemsById: ReadonlyMap<string, DeclutterItem>, id: string): DeclutterItem {
  const item = itemsById.get(id)
  if (item === undefined) {
    throw new Error(`declutter: item id "${id}" is not present in the input items`)
  }
  return item
}

function sortIdsByPriority(
  ids: readonly string[],
  itemsById: ReadonlyMap<string, DeclutterItem>,
): string[] {
  return ids
    .slice()
    .sort((a, b) =>
      comparePriority(
        { id: a, priority: requireItem(itemsById, a).priority },
        { id: b, priority: requireItem(itemsById, b).priority },
      ),
    )
}

// ---------- uniform spatial grid ----------
// Cell size only needs to be >= the largest possible interaction distance
// between two circles for a 3x3 neighbourhood scan to find every pair that
// could overlap (standard uniform-grid / spatial-hash collision result: if
// two points are within distance D of each other and the cell size is >= D,
// their cells can differ by at most one step on each axis). The largest
// possible interaction distance between two nodes is bounded by twice the
// largest pin radius the map draws (see the tier radius ranges in
// `utils/map/marks.ts`) plus the gap.
const MAX_MERGE_RADIUS = 24

class SpatialGrid {
  private readonly cellSize: number
  // Numeric cell keys: a string key per lookup was the hottest allocation in
  // a 1500-station pass. Offsetting by 2^15 keeps negative cells (the cull
  // margin) distinct for any frame under ~32k cells a side.
  private readonly cells = new Map<number, number[]>()
  private readonly stats: DeclutterStats | undefined

  constructor(cellSize: number, stats?: DeclutterStats) {
    this.cellSize = cellSize
    this.stats = stats
  }

  private static key(cx: number, cy: number): number {
    return (cx + 0x8000) * 0x10000 + (cy + 0x8000)
  }

  insert(index: number, x: number, y: number): void {
    const key = SpatialGrid.key(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize))
    const bucket = this.cells.get(key)
    if (bucket) {
      bucket.push(index)
    } else {
      this.cells.set(key, [index])
    }
  }

  neighbors(x: number, y: number): number[] {
    const cx = Math.floor(x / this.cellSize)
    const cy = Math.floor(y / this.cellSize)
    const found: number[] = []
    if (this.stats) this.stats.cellVisits += 9
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.cells.get(SpatialGrid.key(cx + dx, cy + dy))
        if (bucket) for (const index of bucket) found.push(index)
      }
    }
    return found
  }
}

// ---------- greedy largest-first placement ----------

interface MergeNode {
  absorbedIds: string[]
  leadId: string
  leadPriority: number
  r: number
  x: number
  y: number
}

function leafNode(item: DeclutterItem): MergeNode {
  return {
    absorbedIds: [],
    leadId: item.id,
    leadPriority: item.priority,
    r: item.radius,
    x: item.x,
    y: item.y,
  }
}

/**
 * Walks same-layer nodes in priority order (already sorted by the caller)
 * and folds each one into the first already-placed node it overlaps
 * (`need = rA + rB + gap`). A folded node contributes its id, and every id
 * it had already absorbed, to the placed node's `absorbedIds` -- the placed
 * node's own position and radius never move. Runs through a spatial grid so
 * each candidate only rescans its own neighbourhood instead of every placed
 * node.
 */
function mergeLayer(
  ordered: readonly MergeNode[],
  gap: number,
  stats?: DeclutterStats,
): MergeNode[] {
  const cellSize = MAX_MERGE_RADIUS * 2 + gap
  const grid = new SpatialGrid(cellSize, stats)
  const placed: MergeNode[] = []

  for (const candidate of ordered) {
    let hit: MergeNode | null = null
    for (const index of grid.neighbors(candidate.x, candidate.y)) {
      const other = placed[index]
      if (other === undefined) continue
      if (stats) stats.pairChecks += 1
      const need = other.r + candidate.r + gap
      const d = Math.hypot(other.x - candidate.x, other.y - candidate.y)
      if (d < need) {
        hit = other
        break
      }
    }
    if (hit) {
      hit.absorbedIds.push(candidate.leadId, ...candidate.absorbedIds)
      continue
    }
    grid.insert(placed.length, candidate.x, candidate.y)
    placed.push(candidate)
  }

  return placed
}

/**
 * Primary beats secondary: walking primary nodes in priority order, a
 * secondary node overlapping a primary node is absorbed into it
 * (transitively, via its absorbed ids); the primary node's position and
 * radius never move. There is no push-apart step -- with no cluster shape
 * to keep clear of, an overlapping secondary node is always folded in.
 */
function resolveLayers(
  primaryNodes: MergeNode[],
  secondaryNodes: MergeNode[],
  gap: number,
  stats?: DeclutterStats,
): MergeNode[] {
  const primary = primaryNodes.map((node) => ({ ...node, absorbedIds: node.absorbedIds.slice() }))
  let secondaryKeep = secondaryNodes

  for (const p of primary) {
    const next: MergeNode[] = []
    for (const s of secondaryKeep) {
      if (stats) stats.pairChecks += 1
      const need = p.r + s.r + gap
      const d = Math.hypot(p.x - s.x, p.y - s.y)
      if (d < need) {
        p.absorbedIds.push(s.leadId, ...s.absorbedIds)
      } else {
        next.push(s)
      }
    }
    secondaryKeep = next
  }

  return [...primary, ...secondaryKeep]
}

function buildDots(
  nodes: readonly MergeNode[],
  itemsById: ReadonlyMap<string, DeclutterItem>,
): DeclutterDot[] {
  const dots = nodes.map((node): DeclutterDot => ({
    absorbed: sortIdsByPriority(node.absorbedIds, itemsById),
    id: node.leadId,
    kind: 'dot',
    radius: node.r,
    x: node.x,
    y: node.y,
  }))
  dots.sort((a, b) =>
    comparePriority(
      { id: a.id, priority: requireItem(itemsById, a.id).priority },
      { id: b.id, priority: requireItem(itemsById, b.id).priority },
    ),
  )
  return dots
}

// ---------- background ----------

const BACKGROUND_PROXIMITY = 9

function compareBackgroundOrder(a: DeclutterBackgroundItem, b: DeclutterBackgroundItem): number {
  if (a.kind !== b.kind) return a.kind === 'pip' ? -1 : 1
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

function overlapsOccupied(rect: Rect, occupied: readonly Rect[], stats?: DeclutterStats): boolean {
  for (const rectOccupied of occupied) {
    if (stats) stats.occupiedChecks += 1
    if (rectsOverlap(rect, rectOccupied, 1)) return true
  }
  return false
}

function tooCloseToKept(
  item: DeclutterBackgroundItem,
  kept: readonly DeclutterBackgroundItem[],
  grid: SpatialGrid,
  stats?: DeclutterStats,
): boolean {
  for (const neighborIndex of grid.neighbors(item.x, item.y)) {
    const neighbor = kept[neighborIndex]
    if (neighbor === undefined) continue
    if (stats) stats.pairChecks += 1
    if (Math.hypot(neighbor.x - item.x, neighbor.y - item.y) < BACKGROUND_PROXIMITY) return true
  }
  return false
}

/**
 * Pips before voids, then by id; drops one overlapping any occupied rect
 * (placed mark circles, pad 1), or whose centre is within 9 px of an
 * already-kept background item (a spatial grid keeps that check off the
 * O(n^2) path).
 */
function thinBackground(
  background: readonly DeclutterBackgroundItem[],
  occupied: readonly Rect[],
  stats?: DeclutterStats,
): DeclutterBackgroundItem[] {
  const ordered = background.slice().sort(compareBackgroundOrder)
  const grid = new SpatialGrid(BACKGROUND_PROXIMITY, stats)
  const kept: DeclutterBackgroundItem[] = []

  for (const item of ordered) {
    const r = item.kind === 'pip' ? 3 : 4
    const rect = circleRect(item.x, item.y, r)
    if (overlapsOccupied(rect, occupied, stats)) continue
    if (tooCloseToKept(item, kept, grid, stats)) continue
    grid.insert(kept.length, item.x, item.y)
    kept.push(item)
  }

  return kept
}

// ---------- entry point ----------

export function declutter(input: DeclutterInput, stats?: DeclutterStats): DeclutterResult {
  const itemsById = new Map(input.items.map((item) => [item.id, item]))

  const sortedItems = input.items
    .slice()
    .sort((a, b) =>
      comparePriority({ id: a.id, priority: a.priority }, { id: b.id, priority: b.priority }),
    )

  const primaryOrdered = sortedItems.filter((item) => item.layer === 'primary').map(leafNode)
  const secondaryOrdered = sortedItems.filter((item) => item.layer === 'secondary').map(leafNode)

  const primaryMerged = mergeLayer(primaryOrdered, input.gap, stats)
  const secondaryMerged = mergeLayer(secondaryOrdered, input.gap, stats)
  const resolved = resolveLayers(primaryMerged, secondaryMerged, input.gap, stats)

  const marks = buildDots(resolved, itemsById)
  const occupied = marks.map((mark) => circleRect(mark.x, mark.y, mark.radius))
  const background = thinBackground(input.background, occupied, stats)

  return { background, marks }
}

// ---------- peaks ----------

export interface PeakCandidate {
  id: string
  /** Higher wins; an exact tie breaks by ascending id. */
  score: number
  x: number
  y: number
}

/**
 * Picks the ids that earn a numeral: walking candidates strongest first, a
 * candidate is a peak when no already-picked peak sits within `spacing`
 * pixels of it, and the walk stops at `cap` peaks. A spatial grid with
 * `spacing`-sized cells keeps each test to a 3x3 neighbourhood, so the pass
 * is one sort plus O(n).
 */
export function pickPeaks(
  candidates: readonly PeakCandidate[],
  spacing: number,
  cap: number,
): Set<string> {
  const ordered = candidates
    .slice()
    .sort((a, b) =>
      comparePriority({ id: a.id, priority: a.score }, { id: b.id, priority: b.score }),
    )
  const grid = new SpatialGrid(spacing)
  const peaks: PeakCandidate[] = []
  for (const candidate of ordered) {
    if (peaks.length >= cap) break
    const crowded = grid.neighbors(candidate.x, candidate.y).some((index) => {
      const peak = peaks[index]
      return peak !== undefined && Math.hypot(peak.x - candidate.x, peak.y - candidate.y) < spacing
    })
    if (crowded) continue
    grid.insert(peaks.length, candidate.x, candidate.y)
    peaks.push(candidate)
  }
  return new Set(peaks.map((peak) => peak.id))
}

/**
 * The value most of `values` share. A tie goes to the value `severity` ranks
 * higher (the worse state), so a split cell never reads better than it is.
 */
export function majority<T>(values: readonly T[], severity: (value: T) => number): T | undefined {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best: T | undefined
  let bestCount = 0
  for (const [value, count] of counts) {
    const wins =
      count > bestCount ||
      (count === bestCount && best !== undefined && severity(value) > severity(best))
    if (wins) {
      best = value
      bestCount = count
    }
  }
  return best
}
