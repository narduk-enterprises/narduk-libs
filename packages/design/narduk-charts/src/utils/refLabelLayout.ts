export const DEFAULT_REF_LABEL_HEIGHT = 12
export const DEFAULT_REF_LABEL_GAP = 3

export interface RefLabelEntry {
  id: number
  lineY: number
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
