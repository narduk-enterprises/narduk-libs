import type { MapMetrics, MapScheme, MapTokens } from './types'

/**
 * The one TypeScript home of the look. `src/styles/map.css` mirrors the colours as
 * `--color-map-*` custom properties (a test keeps the two in step); the numbers live only
 * here and reach the SVG as inline custom properties. GL style JSON cannot hold
 * `var()` or `color-mix()`, so every colour here is resolved to a literal hex.
 */

type Rgb = [number, number, number]

export function parseHex(hex: string): Rgb | null {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  let value = match[1] as string
  if (value.length === 3) value = [...value].map(c => c + c).join('')
  const n = Number.parseInt(value, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function toHex(rgb: Rgb): string {
  return `#${rgb
    .map(v =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** `mix(a, b, t)`: `t` of `b` over `a`, in sRGB, like `color-mix(in srgb, a, b t%)`. */
export function mix(a: string, b: string, t: number): string {
  const ra = parseHex(a)
  const rb = parseHex(b)
  if (!ra || !rb) return a
  return toHex([0, 1, 2].map(i => (ra[i] as number) * (1 - t) + (rb[i] as number) * t) as Rgb)
}

const LIGHT_BASE = {
  water: '#dfe8ee',
  land: '#f7f6f2',
  ink: '#1f2a33',
  boundary: '#8a97a3',
  markRing: '#ffffff',
  markCore: '#ffffff',
  green: '#5b8a6a',
  shoreTarget: '#9fb6c6',
}

const DARK_BASE = {
  water: '#101b24',
  land: '#1b252e',
  ink: '#e3eaef',
  boundary: '#7b8996',
  markRing: '#11181e',
  markCore: '#e8eef2',
  green: '#6fa081',
  shoreTarget: '#5d7587',
}

function build(base: typeof LIGHT_BASE, roadShare: number, muted: string): MapTokens {
  return {
    water: base.water,
    land: base.land,
    shore: mix(base.water, base.shoreTarget, 0.6),
    boundary: base.boundary,
    boundaryOpacity: 0.7,
    boundaryFocus: base.ink,
    ink: base.ink,
    muted,
    placeInk: mix(base.land, base.ink, 0.62),
    labelHalo: base.land,
    road: mix(base.land, base.ink, roadShare),
    markRing: base.markRing,
    markCore: base.markCore,
    hatch: mix(base.land, base.ink, 0.35),
    green: base.green,
    shoreHalo: mix(base.water, base.shoreTarget, 0.3),
    roadMajor: mix(base.land, base.ink, roadShare * 1.6),
  }
}

export const LIGHT_TOKENS: MapTokens = build(
  LIGHT_BASE,
  0.12,
  mix(LIGHT_BASE.water, '#4f6b7d', 0.8),
)
/** Selected, not inverted: a deep slate sea, land one step lighter, softer ink. */
export const DARK_TOKENS: MapTokens = build(DARK_BASE, 0.16, '#8fa9ba')

export const DEFAULT_METRICS: MapMetrics = {
  markRadius: 7,
  markRadiusSmall: 5,
  markRadiusHighlight: 10,
  markHitRadius: 12,
  markRingWidth: 2,
  markBandWidth: 4,
  markCoreRatio: 0.4,
  markOutlineWidth: 1.5,
  markDashWidth: 1.5,
  markDash: [2.5, 2],
  boundaryWidth: 1,
  boundaryFocusWidth: 2,
  shoreWidth: 1.5,
  haloWidth: 6,
  haloOpacity: 0.35,
  labelSize: 11,
  labelWeight: 600,
  labelSpacing: 0.06,
  labelHaloWidth: 3,
  labelCharWidth: 0.74,
  bmLabelSize: 10,
  bmLabelCharWidth: 0.62,
  hatchSize: 6,
  hatchWidth: 1.5,
  hatchAngle: 45,
}

export function tokensFor(
  scheme: MapScheme = 'light',
  overrides: Partial<MapTokens> = {},
): MapTokens {
  return { ...(scheme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS), ...overrides }
}

export function metricsFor(overrides: Partial<MapMetrics> = {}): MapMetrics {
  return { ...DEFAULT_METRICS, ...overrides }
}
