export {
  createGridOverlay,
  type GridOverlay,
  type GridOverlayOptions,
  type GridOverlayStyleInput,
  type SetScalarFrameOptions,
} from './grid-overlay.js'
export { loadCoastlineStencil, type LoadedCoastlineStencil } from './stencil.js'
/**
 * Re-exported because the `GridOverlay` interface above names them. A consumer
 * importing only `@narduk-enterprises/geogrid-web/overlay` could not otherwise
 * write the type of an `onDisplayRangeChange` listener or a `setStretch`
 * argument without reaching into a second subpath for it.
 */
export type {
  GridDisplayRangeListener,
  GridDisplayRangeMeta,
  GridPercentileStat,
  GridRangeStretch,
  GridStretchReason,
  GridStretchTier,
  GridStretchTimers,
} from '../core/stretch.js'
