import { normalizeWireStops, rampLut } from '../color/ramp.js'
import type { GridScale, RampStop } from '../core/models.js'
import type { GridStyle } from './types.js'

/** The LUT resolution both backends and GeoGridKit bake at. */
export const RAMP_LUT_COUNT = 256

/** `scale` is typed loosely on the wire; anything that is not `log` is linear. */
export function styleScale(style: GridStyle): GridScale {
  return style.scale === 'log' ? 'log' : 'linear'
}

/**
 * The canonical stops a style renders through.
 *
 * A legacy value-domain `ramp` is converted rather than sampled in place. That
 * conversion is the whole point: catalog stops carry raw data values, and
 * interpolating between two of them in *value* space — which is what the old
 * ramp-uniform shader did — puts every color in the wrong place on a log layer.
 * `normalizeWireStops` moves them into position space first, so the ramp lands
 * where `shared/colorramp.py` put it.
 *
 * A degenerate value range is a producer bug that `normalizeWireStops` throws
 * on; a renderer answers it by drawing nothing rather than by taking down the
 * frame loop.
 *
 * The guard is `lo >= hi`, deliberately, and **not** the `!(lo < hi)` that
 * reads as its equal. They differ on a `NaN` bound: `NaN >= hi` is `false`
 * while `!(NaN < hi)` is `true`. `normalizeValue` was corrected to the former
 * in 0.2.1 to match `shared/colorramp.py`, which clamps such a range to `0`
 * rather than raising — so guarding with the latter here would have this
 * renderer blank a layer that the canonical engine, GeoGridKit, and the
 * server's own tiles all still color.
 */
export function resolveRampStops(style: GridStyle): readonly RampStop[] {
  if (style.rampStops) return style.rampStops
  const legacy = style.ramp
  if (!legacy || legacy.length === 0) return []
  const { lowerBound, upperBound } = style.valueRange
  if (lowerBound >= upperBound) return []
  return normalizeWireStops(legacy, style.valueRange, styleScale(style))
}

/** Bake a style's ramp into `RAMP_LUT_COUNT * 4` RGBA bytes. */
export function styleLut(style: GridStyle): Uint8Array {
  return rampLut(resolveRampStops(style), RAMP_LUT_COUNT)
}
