import { Canvas2DGridBackend } from './canvas2d.js'
import { WebGL2GridBackend } from './webgl2.js'
import type { CreateBackendOptions, GridRenderBackend, GridRenderBackendKind } from './types.js'

export interface CreateGridBackendOptions extends CreateBackendOptions {
  prefer?: GridRenderBackendKind
}

/** Prefer WebGL2; fall back to Canvas2D. */
export function createGridBackend(options: CreateGridBackendOptions): GridRenderBackend {
  const prefer = options.prefer ?? 'webgl2'
  if (prefer === 'canvas2d') {
    return Canvas2DGridBackend.create(options)
  }
  const gpu = WebGL2GridBackend.create(options)
  if (gpu) return gpu
  return Canvas2DGridBackend.create(options)
}
