import { frameContentKey } from './math.js'
import type { GridBBoxAnchor, GridFrame, GridValueKind } from './models.js'
import type { TemporalRasterFrame } from './decode/temporal.js'
import type { GridScalarDataset } from './decode/grid.js'

/**
 * Adapters that put both grid dialects into one {@link GridFrame}.
 *
 * The backends used to take `TemporalRasterFrame` directly, which quietly made
 * "a frame" mean "a dated slice of a temporal raster". A `/grid` response is
 * neither dated nor temporal, and the render math does not care: it wants
 * samples, a mask, a geometry, and a cache identity. These functions supply
 * that identity for both, and nothing here copies a sample plane.
 */

/** The `bbox` anchor a dialect implies when the caller names none. */
export function defaultBBoxAnchor(valueKind: GridValueKind): GridBBoxAnchor {
  return valueKind === 'float32' ? 'cell-center' : 'cell-edge'
}

/** Whether a value is already a {@link GridFrame} rather than a temporal one. */
export function isGridFrame(frame: GridFrame | TemporalRasterFrame): frame is GridFrame {
  return 'valueKind' in frame
}

/**
 * View a temporal frame as a {@link GridFrame}. A rename, not a copy — the
 * sample planes are passed through by reference.
 */
export function gridFrameFromTemporal(frame: TemporalRasterFrame): GridFrame {
  return {
    key: frame.date,
    width: frame.width,
    height: frame.height,
    renderMode: frame.renderMode,
    valueKind: 'encoded-u16',
    values: frame.values,
    mask: frame.mask,
    ...(frame.channels ? { channels: frame.channels } : {}),
    ...(frame.rgbComposition ? { rgbComposition: frame.rgbComposition } : {}),
  }
}

/** Accept either dialect and answer with the common shape. */
export function toGridFrame(frame: GridFrame | TemporalRasterFrame): GridFrame {
  return isGridFrame(frame) ? frame : gridFrameFromTemporal(frame)
}

interface MemoizedKey {
  mask: object
  channel: object | null
  composition: object | null
  key: string
}

const contentKeys = new WeakMap<object, MemoizedKey>()

/**
 * A frame's GPU-cache identity, computed once per distinct sample plane.
 *
 * {@link frameContentKey} reads every element — it has to, because sampling a
 * stride made it collide on grids differing in tens of thousands of cells — and
 * that costs about 3.6 ms for a 512×512 plane and its mask. Once, at decode
 * time, that is free. Once per frame per plane, which is what a backend calling
 * it straight from its render path does, it is roughly 7 ms of a 16.7 ms
 * budget, and the fingerprint would have become more expensive than the upload
 * it exists to avoid.
 *
 * Memoizing on the identity of the arrays is sound because nothing in this
 * package rewrites a plane in place: both decoders allocate fresh arrays per
 * frame, so a re-decode — the case the fingerprint exists for — always arrives
 * as new objects. A caller who does mutate a plane in place is telling the
 * renderer nothing changed, and should pass its own `key` instead.
 */
export function frameCacheKey(frame: GridFrame): string {
  const channel = frame.channels?.[0] ?? null
  const composition = frame.rgbComposition ?? null
  const cached = contentKeys.get(frame.values)
  if (
    cached &&
    cached.mask === frame.mask &&
    cached.channel === channel &&
    cached.composition === composition
  ) {
    return cached.key
  }
  const key = frameContentKey(
    frame.key,
    frame.width,
    frame.height,
    frame.values,
    frame.mask,
    frame.channels,
    frame.rgbComposition,
  )
  contentKeys.set(frame.values, {
    mask: frame.mask,
    channel,
    composition,
    key,
  })
  return key
}

export interface ScalarFrameOptions {
  /**
   * Cache identity. Defaults to a content fingerprint of the plane itself,
   * which is the right answer when a dataset is refetched: the same layer at
   * the same geometry with new bytes must not reuse the old GPU texture, and
   * there is no date here to tell them apart.
   *
   * Pass one explicitly when you already hold a cheaper and stronger identity —
   * an ETag, `header.releaseId`, `header.generationId`. The default reads the
   * whole plane to build its hash, and a 32-bit hash is a fingerprint, not a
   * proof; a key the publisher already guarantees unique beats it on both
   * counts.
   */
  key?: string
}

/**
 * One plane of a decoded `/grid` dataset, as a renderable frame.
 *
 * @throws RangeError when the plane index is not in the dataset.
 */
export function gridFrameFromScalarDataset(
  dataset: GridScalarDataset,
  planeIndex = 0,
  options: ScalarFrameOptions = {},
): GridFrame {
  const values = dataset.planes[planeIndex]
  const mask = dataset.masks[planeIndex]
  if (!values || !mask) {
    throw new RangeError(
      `grid dataset has no plane ${planeIndex} (planeCount ${dataset.header.planeCount})`,
    )
  }
  const { width, height, layer } = dataset.header
  const name = dataset.header.variables[planeIndex] ?? String(planeIndex)
  return {
    key: options.key ?? `${layer}:${name}:${frameContentKey('', width, height, values, mask)}`,
    width,
    height,
    renderMode: 'scalar',
    valueKind: 'float32',
    values,
    mask,
  }
}
