/**
 * Greedy text-label placement under already-placed discs. Each label hangs
 * centred below its own disc; it is kept only when its box touches no other
 * disc, no earlier label and no blocked box. Callers pass labels best first,
 * so a crowd drops its weakest labels, never a pin (a disc is never moved).
 * Vocabulary-free like the rest of `utils/mapkit`.
 */

export interface LabelDisc {
  id: string
  radius: number
  x: number
  y: number
}

export interface LabelRequest {
  height: number
  /** Id of the disc this label hangs under. */
  id: string
  width: number
}

export interface LabelBox {
  bottom: number
  left: number
  right: number
  top: number
}

export interface LabelPlacementInput {
  /** Areas no label may enter, e.g. a selected pin's callout. */
  blocked?: readonly LabelBox[]
  discs: readonly LabelDisc[]
  /** Clear space between a label and anything else, in px. */
  gap: number
  /** Space between a disc's edge and the top of its label, in px. */
  offset: number
  /** Labels in placement order, best first. */
  requests: readonly LabelRequest[]
}

const CELL = 64

type Shape = { box: LabelBox; kind: 'box' } | { disc: LabelDisc; kind: 'disc' }

function cellKey(cx: number, cy: number): number {
  return (cx + 0x8000) * 0x10000 + (cy + 0x8000)
}

function discBox(disc: LabelDisc): LabelBox {
  return {
    bottom: disc.y + disc.radius,
    left: disc.x - disc.radius,
    right: disc.x + disc.radius,
    top: disc.y - disc.radius,
  }
}

/** Calls `visit` for every grid cell a box covers. */
function eachCell(box: LabelBox, visit: (key: number) => void): void {
  const x0 = Math.floor(box.left / CELL)
  const x1 = Math.floor(box.right / CELL)
  const y0 = Math.floor(box.top / CELL)
  const y1 = Math.floor(box.bottom / CELL)
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) visit(cellKey(cx, cy))
  }
}

function boxesTouch(a: LabelBox, b: LabelBox, gap: number): boolean {
  return (
    a.left < b.right + gap &&
    b.left < a.right + gap &&
    a.top < b.bottom + gap &&
    b.top < a.bottom + gap
  )
}

function boxTouchesDisc(box: LabelBox, disc: LabelDisc, gap: number): boolean {
  const dx = Math.max(box.left - disc.x, 0, disc.x - box.right)
  const dy = Math.max(box.top - disc.y, 0, disc.y - box.bottom)
  const reach = disc.radius + gap
  return dx * dx + dy * dy < reach * reach
}

function touches(shape: Shape, box: LabelBox, owner: string, gap: number): boolean {
  if (shape.kind === 'box') return boxesTouch(shape.box, box, gap)
  return shape.disc.id !== owner && boxTouchesDisc(box, shape.disc, gap)
}

/** The box a label of this size occupies under its disc. */
export function labelBox(disc: LabelDisc, request: LabelRequest, offset: number): LabelBox {
  const top = disc.y + disc.radius + offset
  return {
    bottom: top + request.height,
    left: disc.x - request.width / 2,
    right: disc.x + request.width / 2,
    top,
  }
}

/** Ids of the labels that fit, in the order they were placed. */
export function placeLabels(input: LabelPlacementInput): string[] {
  const { gap, offset } = input
  const grid = new Map<number, Shape[]>()
  const insert = (shape: Shape, box: LabelBox) =>
    eachCell(box, (key) => {
      const bucket = grid.get(key)
      if (bucket) bucket.push(shape)
      else grid.set(key, [shape])
    })
  const discs = new Map<string, LabelDisc>()
  for (const disc of input.discs) {
    discs.set(disc.id, disc)
    insert({ disc, kind: 'disc' }, discBox(disc))
  }
  for (const box of input.blocked ?? []) insert({ box, kind: 'box' }, box)

  const placed: string[] = []
  for (const request of input.requests) {
    const disc = discs.get(request.id)
    if (!disc) continue
    const box = labelBox(disc, request, offset)
    const reach = {
      bottom: box.bottom + gap,
      left: box.left - gap,
      right: box.right + gap,
      top: box.top - gap,
    }
    let clear = true
    eachCell(reach, (key) => {
      if (clear)
        clear = !(grid.get(key) ?? []).some((shape) => touches(shape, box, request.id, gap))
    })
    if (!clear) continue
    placed.push(request.id)
    insert({ box, kind: 'box' }, box)
  }
  return placed
}
