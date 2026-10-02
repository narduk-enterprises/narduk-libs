import type { VectorTileCanvas, VectorTileCanvasContext } from '../../src/client/index.js'

export type PaintCall =
  | { op: 'clearRect'; args: number[] }
  | { op: 'moveTo' | 'lineTo'; args: number[] }
  | { op: 'stroke'; strokeStyle: string; lineWidth: number; globalAlpha: number }

export interface FakeCanvas extends VectorTileCanvas {
  calls: PaintCall[]
}

/** A canvas that records what the painter drew, for asserting on geometry. */
export function createFakeCanvas(width: number, height: number): FakeCanvas {
  const calls: PaintCall[] = []
  const context: VectorTileCanvasContext = {
    globalAlpha: 1,
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    beginPath: () => {},
    clearRect: (...args) => calls.push({ op: 'clearRect', args }),
    lineTo: (...args) => calls.push({ op: 'lineTo', args }),
    moveTo: (...args) => calls.push({ op: 'moveTo', args }),
    stroke: () =>
      calls.push({
        op: 'stroke',
        globalAlpha: context.globalAlpha,
        lineWidth: context.lineWidth,
        strokeStyle: String(context.strokeStyle),
      }),
  }
  return { calls, height, width, getContext: () => context }
}

/** Resolves when `condition` holds, polling microtasks; fails the test by timeout otherwise. */
export async function until(condition: () => boolean, label = 'condition') {
  for (let turn = 0; turn < 200; turn += 1) {
    if (condition()) return
    await Promise.resolve()
  }
  throw new Error(`never became true: ${label}`)
}
