/**
 * The smallest `OffscreenCanvas` that lets the tile baker's CPU path be
 * asserted in Node.
 *
 * Node has no `OffscreenCanvas` and no `ImageData`, so `renderGridTile` — whose
 * whole contract is "returns a canvas, never null" — would otherwise be
 * unassertable outside a browser, and the two properties that matter most
 * (a tile's pixel size, and an empty tile still being a canvas) would ship
 * untested. This shim implements exactly the four calls the baker makes:
 * `new OffscreenCanvas(w, h)`, `getContext('2d')`, `createImageData`, and
 * `putImageData` at the origin.
 *
 * It proves the baker's *logic*, not a browser's canvas. Real WebGL/browser
 * parity is a browser-context job and is tracked separately.
 */

export interface FakeImageData {
  data: Uint8ClampedArray
  width: number
  height: number
}

class FakeOffscreenCanvasRenderingContext2D {
  imageData: FakeImageData | null = null

  createImageData(width: number, height: number): FakeImageData {
    return { data: new Uint8ClampedArray(width * height * 4), width, height }
  }

  putImageData(image: FakeImageData, dx: number, dy: number): void {
    if (dx !== 0 || dy !== 0) throw new Error('test shim only supports putImageData at the origin')
    this.imageData = image
  }
}

class FakeOffscreenCanvas {
  context: FakeOffscreenCanvasRenderingContext2D | null = null

  constructor(
    public width: number,
    public height: number,
  ) {}

  getContext(kind: string): FakeOffscreenCanvasRenderingContext2D | null {
    if (kind !== '2d') return null
    this.context ??= new FakeOffscreenCanvasRenderingContext2D()
    return this.context
  }
}

interface CanvasGlobals {
  OffscreenCanvas?: unknown
}

/** Install the shim. Returns the uninstaller; call it in `afterAll`. */
export function installOffscreenCanvas(): () => void {
  const globals = globalThis as CanvasGlobals
  const previous = globals.OffscreenCanvas
  const had = 'OffscreenCanvas' in globals
  globals.OffscreenCanvas = FakeOffscreenCanvas
  return () => {
    if (had) globals.OffscreenCanvas = previous
    else delete globals.OffscreenCanvas
  }
}

/**
 * The RGBA the baker wrote into a canvas.
 *
 * A canvas that was never drawn into reads as fully transparent, which is what
 * a real one would be — that is the whole point of returning a blank canvas for
 * a tile with nothing in it rather than returning `null`.
 */
export function canvasPixels(canvas: unknown): Uint8ClampedArray {
  const fake = canvas as FakeOffscreenCanvas
  return fake.context?.imageData?.data ?? new Uint8ClampedArray(fake.width * fake.height * 4)
}

export function canvasSize(canvas: unknown): { width: number; height: number } {
  const fake = canvas as FakeOffscreenCanvas
  return { width: fake.width, height: fake.height }
}

/**
 * Whether a rendering context was ever obtained for this canvas.
 *
 * Not a detail: a real `OffscreenCanvas` whose context mode is still "none"
 * throws `InvalidStateError` from `transferToImageBitmap()`, so an empty tile
 * built by `new OffscreenCanvas(...)` and an empty tile built by drawing zeroes
 * are *not* interchangeable for a host that does more than `drawImage`. Both
 * read as transparent through {@link canvasPixels}, which is exactly why the
 * difference needs its own accessor to be assertable at all.
 */
export function canvasHasContext(canvas: unknown): boolean {
  return (canvas as FakeOffscreenCanvas).context !== null
}
