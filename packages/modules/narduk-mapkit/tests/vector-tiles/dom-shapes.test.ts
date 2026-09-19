import type {
  VectorTileCanvas,
  VectorTileOverlaySource,
  VectorTileWorkerPort,
} from '../../src/client/index.js'

/**
 * The client interfaces are hand-written so the module needs no DOM at
 * runtime, which makes it possible for them to drift from the browser types
 * they stand in for — and a drift only an app discovers is a drift found too
 * late. These assertions fail at typecheck, not at run time; the bodies exist
 * so the file is a test rather than a comment.
 */
describe('the browser types these interfaces stand in for', () => {
  it('accepts a real canvas element as a paint surface', () => {
    const element = null as unknown as HTMLCanvasElement
    const surface: VectorTileCanvas = element

    expect(surface).toBeNull()
  })

  it('accepts a real canvas element as the overlay source parameter', () => {
    const source = null as unknown as VectorTileOverlaySource<HTMLCanvasElement>

    expect(source).toBeNull()
  })

  it('accepts a real Worker as a decoder port', () => {
    const worker = null as unknown as Worker
    const port: VectorTileWorkerPort = worker

    expect(port).toBeNull()
  })
})
