// Field maths shared by the GPU layer and the readout: terrarium decode, bilinear over texels that
// have data, the ramp texture in stored units, display units and legend ticks. The shader in
// field-layer.ts mirrors `decodeTerrarium` and `bilinear` line for line, so a readout is the value
// the pixel was coloured from.

import type { GeoField, GeoLayer, GeoRampStop } from './catalog'

export const RAMP_SIZE = 256

/** Terrarium: v = R·256 + G + B/256 − 32768; alpha 0 = no data. */
export function decodeTerrarium(r: number, g: number, b: number, a: number): number | null {
  if (a === 0) return null
  return r * 256 + g + b / 256 - 32768
}

/** uv: u = int16(R·256+G)·scale, v = int16(B·256+A)·scale; −32768 in either = no data. */
export function decodeUv(
  r: number,
  g: number,
  b: number,
  a: number,
  scale = 0.01,
): { u: number; v: number } | null {
  const toInt16 = (hi: number, lo: number) => {
    const n = hi * 256 + lo
    return n >= 32768 ? n - 65536 : n
  }
  const u = toInt16(r, g)
  const v = toInt16(b, a)
  if (u === -32768 || v === -32768) return null
  return { u: u * scale, v: v * scale }
}

export interface Texels {
  data: Uint8Array
  height: number
  width: number
}

/**
 * Bilinear value at texel-space position (px, py) (texel centres at i + 0.5), weighting only the
 * texels that have data. Edges clamp. Returns the value and the data coverage (0–1).
 */
export function bilinear(t: Texels, px: number, py: number): { coverage: number; value: number } {
  const x = px - 0.5
  const y = py - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  let sum = 0
  let wsum = 0
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const cx = Math.min(Math.max(x0 + i, 0), t.width - 1)
      const cy = Math.min(Math.max(y0 + j, 0), t.height - 1)
      const o = (cy * t.width + cx) * 4
      const v = decodeTerrarium(t.data[o]!, t.data[o + 1]!, t.data[o + 2]!, t.data[o + 3]!)
      if (v === null) continue
      const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy)
      sum += w * v
      wsum += w
    }
  }
  return { coverage: wsum, value: wsum > 0 ? sum / wsum : Number.NaN }
}

/** The ramp as RAMP_SIZE RGBA8 texels, linear in stored units across `range`. */
export function rampTexture(stops: GeoRampStop[], range: [number, number]): Uint8Array {
  const out = new Uint8Array(RAMP_SIZE * 4)
  if (!stops.length) return out
  const [lo, hi] = range
  for (let i = 0; i < RAMP_SIZE; i++) {
    const v = lo + ((hi - lo) * i) / (RAMP_SIZE - 1)
    let k = 0
    while (k < stops.length - 2 && stops[k + 1]!.value < v) k++
    const s0 = stops[k]!
    const s1 = stops[Math.min(k + 1, stops.length - 1)]!
    const span = s1.value - s0.value
    const f = span > 0 ? Math.min(Math.max((v - s0.value) / span, 0), 1) : 0
    out[i * 4] = Math.round(s0.r + (s1.r - s0.r) * f)
    out[i * 4 + 1] = Math.round(s0.g + (s1.g - s0.g) * f)
    out[i * 4 + 2] = Math.round(s0.b + (s1.b - s0.b) * f)
    out[i * 4 + 3] = Math.round(s0.a + (s1.a - s0.a) * f)
  }
  return out
}

/** CSS gradient from the same texels the GPU uses. */
export function rampCss(stops: GeoRampStop[], range: [number, number]): string {
  const px = rampTexture(stops, range)
  const parts: string[] = []
  for (let i = 0; i <= 16; i++) {
    const k = Math.round((i / 16) * (RAMP_SIZE - 1))
    parts.push(`rgb(${px[k * 4]} ${px[k * 4 + 1]} ${px[k * 4 + 2]}) ${(i / 16) * 100}%`)
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

// ---------- Units ----------

/** Stored value → the physical quantity (undo log10). */
export function toQuantity(field: GeoField, stored: number): number {
  return field.transform === 'log10' ? 10 ** stored : stored
}

export function prettyUnits(units: string | undefined): string {
  const u = (units ?? '').trim()
  if (u === 'mg m-3' || u === 'mg/m3' || u === 'mg m^-3') return 'mg/m³'
  if (u === 'm-1') return 'm⁻¹'
  if (u === 'm s-1' || u === 'm/s') return 'm/s'
  return u
}

/** Significant-digit formatting that never shows exponent notation. */
export function sig(v: number, digits: number): string {
  if (v === 0 || !Number.isFinite(v)) return v === 0 ? '0' : '—'
  const d = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(v))))
  return Number(v.toFixed(Math.min(d, 6))).toString()
}

export interface FieldReading {
  primary: string
  secondary?: string
}

/** A stored value as a person reads it: display units first (°F for °C), base units beside. */
export function formatFieldValue(layer: GeoLayer, stored: number): FieldReading {
  const field = layer.field!
  const q = toQuantity(field, stored)
  const units = prettyUnits(layer.units)
  const digits = field.transform === 'log10' ? 2 : 3
  const fmt = (v: number) => (units.startsWith('°') ? v.toFixed(1) : sig(v, digits))
  const d = field.display
  if (d) {
    const shown = q * d.scale + d.offset
    const dUnits = prettyUnits(d.units)
    return {
      primary: `${dUnits.startsWith('°') ? shown.toFixed(1) : sig(shown, digits)} ${dUnits}`,
      secondary: `${fmt(q)} ${units}`.trim(),
    }
  }
  return { primary: `${fmt(q)} ${units}`.trim() }
}

export function displayUnits(layer: GeoLayer): string {
  return prettyUnits(layer.field?.display?.units ?? layer.units)
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

/** Legend ticks in display units, as positions 0–1 across the stored range. */
export function fieldTicks(layer: GeoLayer): Array<{ at: number; label: string }> {
  const field = layer.field!
  const [lo, hi] = field.range
  const pos = (stored: number) => (stored - lo) / (hi - lo)
  const out: Array<{ at: number; label: string }> = []
  if (field.transform === 'log10') {
    const decades = hi - lo
    const mantissas = decades > 3 ? [1] : decades > 1.5 ? [1, 3] : [1, 2, 5]
    for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) {
      for (const m of mantissas) {
        const stored = Math.log10(m) + e
        if (stored < lo - 1e-9 || stored > hi + 1e-9) continue
        out.push({ at: pos(stored), label: sig(m * 10 ** e, 1) })
      }
    }
    return out
  }
  const d = field.display ?? { scale: 1, offset: 0, units: layer.units ?? '' }
  const a = lo * d.scale + d.offset
  const b = hi * d.scale + d.offset
  const step = niceStep(Math.abs(b - a) / 4)
  const degrees = prettyUnits(d.units).startsWith('°')
  for (let v = Math.ceil(Math.min(a, b) / step) * step; v <= Math.max(a, b) + 1e-9; v += step) {
    const stored = (v - d.offset) / d.scale
    const label = Number(v.toFixed(6)).toString()
    out.push({ at: pos(stored), label: degrees ? `${label}°` : label })
  }
  return out
}
