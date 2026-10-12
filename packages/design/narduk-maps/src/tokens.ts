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

/**
 * The approved basemap look ("harbor", design/narduk-maps/gen/style.mjs). Basemap colours are
 * literal; ink, focus, the marks and the tooltip are data and state tokens and stay put.
 */
const LIGHT_BASE = {
  land: '#f6f5f1',
  water: '#d3e2eb',
  shore: '#8fb0c4',
  shoreHalo: '#b9d0de',
  green: '#e9eee2',
  road: '#e4e1d8',
  roadMajor: '#dcd7cb',
  boundary: '#b7bec5',
  label: '#2b3742',
  labelHalo: '#f6f5f1',
  waterLabel: '#5d7f95',
  ink: '#1f2a33',
  markRing: '#ffffff',
  markCore: '#ffffff',
}

const DARK_BASE: typeof LIGHT_BASE = {
  land: '#1a2128',
  water: '#0f1a22',
  shore: '#3f5f73',
  shoreHalo: '#1d3240',
  green: '#1c2620',
  road: '#262e36',
  roadMajor: '#2e3740',
  boundary: '#4b5864',
  label: '#d2dae1',
  labelHalo: '#1a2128',
  waterLabel: '#7d9bb0',
  ink: '#e3eaef',
  markRing: '#11181e',
  markCore: '#e8eef2',
}

function build(base: typeof LIGHT_BASE): MapTokens {
  return {
    water: base.water,
    land: base.land,
    shore: base.shore,
    boundary: base.boundary,
    boundaryOpacity: 1,
    boundaryFocus: base.ink,
    ink: base.ink,
    muted: base.waterLabel,
    placeInk: base.label,
    labelHalo: base.labelHalo,
    road: base.road,
    markRing: base.markRing,
    markCore: base.markCore,
    hatch: mix(base.land, base.ink, 0.35),
    green: base.green,
    shoreHalo: base.shoreHalo,
    roadMajor: base.roadMajor,
  }
}

export const LIGHT_TOKENS: MapTokens = build(LIGHT_BASE)
/** Selected, not inverted: a deep slate sea, land one step lighter, softer ink. */
export const DARK_TOKENS: MapTokens = build(DARK_BASE)

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
  haloWidth: 10,
  haloOpacity: 0.9,
  labelSize: 11,
  labelWeight: 600,
  labelSpacing: 0.06,
  labelHaloWidth: 3,
  labelCharWidth: 0.74,
  bmLabelSize: 10,
  bmLabelCharWidth: 0.62,
  bmPlaceCharWidth: 0.8,
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
