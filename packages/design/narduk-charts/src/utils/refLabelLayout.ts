export const DEFAULT_REF_LABEL_HEIGHT = 12
export const DEFAULT_REF_LABEL_GAP = 3

/** Estimated half-width for short numeric reference labels above vertical guides (px). */
export const DEFAULT_REF_LABEL_HALF_WIDTH = 28

export interface RefLabelEntry {
  id: number
  lineY: number
}

export interface RefLabelXEntry {
  id: number
  lineX: number
}

/**
 * Compute non-overlapping vertical positions for labels anchored on the right
 * (e.g. horizontal reference guides). SVG Y increases downward.
 */
export function layoutReferenceLabelYs(
  entries: readonly RefLabelEntry[],
  bounds: { top: number; bottom: number },
  opts?: { labelHeight?: number; gap?: number },
): Map<number, number> {
  const h = opts?.labelHeight ?? DEFAULT_REF_LABEL_HEIGHT
  const gap = opts?.gap ?? DEFAULT_REF_LABEL_GAP
  const half = h / 2
  const yMin = bounds.top + half
  const yMax = bounds.bottom - half

  const labelY = new Map<number, number>()
  if (entries.length === 0) return labelY

  const sorted = [...entries].sort((a, b) => a.lineY - b.lineY)

  let prevBottom = -Infinity
  for (const e of sorted) {
    let y = e.lineY
    if (y - half < prevBottom + gap) y = prevBottom + gap + half
    y = Math.min(Math.max(y, yMin), yMax)
    labelY.set(e.id, y)
    prevBottom = y + half
  }

  for (let i = sorted.length - 2; i >= 0; i--) {
    const cur = sorted[i]!
    const nxt = sorted[i + 1]!
    let yCur = labelY.get(cur.id)!
    const yNxt = labelY.get(nxt.id)!
    if (yNxt - yCur < h + gap) {
      yCur = yNxt - h - gap
      labelY.set(cur.id, Math.max(yCur, yMin))
    }
  }

  prevBottom = -Infinity
  for (const e of sorted) {
    let y = labelY.get(e.id)!
    if (y - half < prevBottom + gap) y = prevBottom + gap + half
    y = Math.min(Math.max(y, yMin), yMax)
    labelY.set(e.id, y)
    prevBottom = y + half
  }

  return labelY
}

/**
 * Compute non-overlapping horizontal positions for labels anchored above the plot
 * (e.g. vertical reference guides on horizontal bar charts).
 */
export function layoutReferenceLabelXs(
  entries: readonly RefLabelXEntry[],
  bounds: { left: number; right: number },
  opts?: { halfWidth?: number; gap?: number },
): Map<number, number> {
  const half = opts?.halfWidth ?? DEFAULT_REF_LABEL_HALF_WIDTH
  const gap = opts?.gap ?? DEFAULT_REF_LABEL_GAP
  const labelX = new Map<number, number>()
  if (entries.length === 0) return labelX

  const sorted = [...entries].sort((a, b) => a.lineX - b.lineX)

  let prevRight = -Infinity
  for (const e of sorted) {
    let x = e.lineX
    if (x - half < prevRight + gap) x = prevRight + gap + half
    x = Math.min(Math.max(x, bounds.left + half), bounds.right - half)
    labelX.set(e.id, x)
    prevRight = x + half
  }

  for (let i = sorted.length - 2; i >= 0; i--) {
    const cur = sorted[i]!
    const nxt = sorted[i + 1]!
    let xCur = labelX.get(cur.id)!
    const xNxt = labelX.get(nxt.id)!
    if (xNxt - xCur < 2 * half + gap) {
      xCur = xNxt - 2 * half - gap
      labelX.set(cur.id, Math.max(xCur, bounds.left + half))
    }
  }

  prevRight = -Infinity
  for (const e of sorted) {
    let x = labelX.get(e.id)!
    if (x - half < prevRight + gap) x = prevRight + gap + half
    x = Math.min(Math.max(x, bounds.left + half), bounds.right - half)
    labelX.set(e.id, x)
    prevRight = x + half
  }

  return labelX
}
