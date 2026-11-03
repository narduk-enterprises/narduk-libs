// Narduk Geo catalog v2: index → product catalogs → layers. A malformed or unknown layer is
// skipped with a reason, never the whole catalog; a product whose catalog fails is skipped, never
// the index. Every URL is resolved against the document it came from.

export const GEO_GROUPS = [
  'temperature',
  'biology',
  'clarity',
  'color',
  'currents',
  'wind',
  'waves',
  'weather',
  'seafloor',
  'structure',
  'reference',
] as const

export type GeoGroup = (typeof GEO_GROUPS)[number]

export const GROUP_NAMES: Record<GeoGroup, string> = {
  temperature: 'Temperature',
  biology: 'Biology',
  clarity: 'Clarity',
  color: 'Water colour',
  currents: 'Currents',
  wind: 'Wind',
  waves: 'Waves',
  weather: 'Weather',
  seafloor: 'Seafloor',
  structure: 'Structure',
  reference: 'Reference',
}

export interface GeoRampStop {
  a: number
  b: number
  g: number
  r: number
  value: number
}

export interface GeoField {
  display?: { offset: number; scale: number; units: string }
  encoding: 'terrarium' | 'uv'
  ramp: GeoRampStop[]
  range: [number, number]
  /** m/s per unit for uv fields. */
  scale?: number
  step?: number
  transform: 'linear' | 'log10'
}

export interface GeoArchive {
  bbox: [number, number, number, number]
  maxZoom: number
  minZoom: number
  url: string
}

export interface GeoFrame {
  /** Every archive that makes up this frame (one for a time frame; a static layer may have several). */
  archives: GeoArchive[]
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHHZ`; null for a static layer. */
  time: string | null
}

export interface GeoSource {
  attribution?: string
  id?: string
  licence?: string
  name?: string
  resolution?: string
  url?: string
}

export interface GeoVector {
  geometry?: string
  /** MVT layer names inside the archive. */
  layers: string[]
}

export interface GeoLayer {
  bbox: [number, number, number, number]
  cadence?: string
  /** Producer caveats, shown in the layer's info. */
  caveats: string[]
  completeness?: 'filled' | 'observed'
  field?: GeoField
  frames: GeoFrame[]
  group: GeoGroup
  id: string
  kind: 'field' | 'image' | 'vector'
  maxZoom: number
  minZoom: number
  notForNavigation: boolean
  source: GeoSource
  /**
   * The finest zooms exist only where a finer source does: a tile absent at its zoom (no archive
   * covers it, or its archive has no such tile) shows its nearest ancestor instead of nothing.
   */
  sparse?: boolean
  title: string
  twin?: string
  units?: string
  vector?: GeoVector
}

export interface GeoCatalog {
  attribution?: string
  generatedAt?: string
  layers: GeoLayer[]
  product: string
  releaseId?: string
  /** Layers left out, with why (for the console and tests, never the screen). */
  skipped: Array<{ id: string; reason: string }>
  title: string
  url: string
}

export interface GeoIndexEntry {
  catalog: string
  group?: string
  id: string
  title: string
}

export const DEFAULT_GEO_BASE = 'https://tiles.nard.uk/geo/'

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0

const TIME = /^\d{4}-\d{2}-\d{2}(?:T\d{2}(?::\d{2})?Z?)?$/

function bbox(v: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(isNum)) return undefined
  const [w, s, e, n] = v as number[]
  if (!(w! < e! && s! < n!)) return undefined
  return [w!, s!, e!, n!]
}

/** Resolve a document-relative URL. */
export function resolveAgainst(base: string, relative: string): string {
  return new URL(relative, base).toString()
}

/** The index URL for a base (`https://tiles.nard.uk/geo/` → `.../geo/index.json`). */
export function indexUrl(base: string, origin?: string): string {
  const b = base.endsWith('/') || base.endsWith('.json') ? base : `${base}/`
  const abs = origin ? new URL(b, origin).toString() : b
  return abs.endsWith('.json') ? abs : `${abs}index.json`
}

export function parseIndex(body: unknown, url: string): GeoIndexEntry[] {
  if (!isObj(body) || !Array.isArray(body.products)) throw new Error('index has no products')
  const out: GeoIndexEntry[] = []
  for (const p of body.products) {
    if (!isObj(p) || !isStr(p.id) || !isStr(p.catalog)) continue
    const groups = Array.isArray(p.groups) ? p.groups.filter(isStr) : []
    out.push({
      id: p.id,
      title: isStr(p.title) ? p.title : p.id,
      group: isStr(p.group) ? p.group : groups[0],
      catalog: resolveAgainst(url, p.catalog),
    })
  }
  return out
}

function parseRamp(v: unknown): GeoRampStop[] | undefined {
  if (!Array.isArray(v) || v.length < 2) return undefined
  const stops: GeoRampStop[] = []
  for (const s of v) {
    if (!isObj(s) || !isNum(s.value) || !isNum(s.r) || !isNum(s.g) || !isNum(s.b)) return undefined
    stops.push({ value: s.value, r: s.r, g: s.g, b: s.b, a: isNum(s.a) ? s.a : 255 })
  }
  stops.sort((x, y) => x.value - y.value)
  return stops
}

function parseField(v: unknown): GeoField | string {
  if (!isObj(v)) return 'no field'
  if (v.encoding !== 'terrarium' && v.encoding !== 'uv') return `encoding ${String(v.encoding)}`
  const range =
    Array.isArray(v.range) && v.range.length === 2 && v.range.every(isNum)
      ? ([v.range[0], v.range[1]] as [number, number])
      : null
  if (!range || !(range[0] < range[1])) return 'bad range'
  const ramp = parseRamp(v.ramp)
  if (!ramp) return 'bad ramp'
  const transform = v.transform === undefined ? 'linear' : v.transform
  if (transform !== 'linear' && transform !== 'log10') return `transform ${String(transform)}`
  const d = v.display
  const display =
    isObj(d) && isStr(d.units)
      ? {
          units: d.units,
          scale: isNum(d.scale) ? d.scale : 1,
          offset: isNum(d.offset) ? d.offset : 0,
        }
      : undefined
  return {
    encoding: v.encoding,
    transform,
    range,
    ramp,
    step: isNum(v.step) ? v.step : undefined,
    scale: isNum(v.scale) ? v.scale : undefined,
    display,
  }
}

function layerVector(v: Json): GeoVector | null | undefined {
  if (v.kind !== 'vector') return undefined
  const vec = isObj(v.vector) ? v.vector : {}
  const layers = Array.isArray(vec.layers) ? vec.layers.filter(isStr) : []
  return layers.length ? { layers, geometry: str(vec.geometry) } : null
}

/** One catalog layer, or the reason it is skipped. */
const str = (v: unknown): string | undefined => (isStr(v) ? v : undefined)

interface LayerBase {
  box: [number, number, number, number]
  catalogUrl: string
  maxZoom: number
  minZoom: number
}

function parseFrames(v: Json, base: LayerBase): GeoFrame[] {
  const { box, catalogUrl, minZoom, maxZoom } = base
  if (Array.isArray(v.frames)) {
    const frames: GeoFrame[] = []
    for (const f of v.frames) {
      if (!isObj(f) || !isStr(f.time) || !TIME.test(f.time) || !isStr(f.url)) continue
      const url = resolveAgainst(catalogUrl, f.url)
      frames.push({ time: f.time, archives: [{ url, bbox: box, minZoom, maxZoom }] })
    }
    return frames.sort((a, b) => frameMs(a.time!) - frameMs(b.time!))
  }
  if (!Array.isArray(v.archives)) return []
  const archives: GeoArchive[] = []
  for (const a of v.archives) {
    if (!isObj(a) || !isStr(a.url)) continue
    archives.push({
      url: resolveAgainst(catalogUrl, a.url),
      bbox: bbox(a.bbox) ?? box,
      minZoom: isNum(a.minZoom) ? a.minZoom : minZoom,
      maxZoom: isNum(a.maxZoom) ? a.maxZoom : maxZoom,
    })
  }
  return archives.length ? [{ time: null, archives }] : []
}

function parseSource(v: unknown): GeoSource {
  const src = isObj(v) ? v : {}
  return {
    name: str(src.name),
    id: str(src.id),
    url: str(src.url),
    attribution: str(src.attribution),
    resolution: str(src.resolution),
    licence: str(src.licence),
  }
}

function layerField(v: Json): GeoField | string | undefined {
  if (v.kind !== 'field') return undefined
  // uv fields (wind, currents) parse and list, but stay disabled in the panel: see FLOW_SOON.
  return parseField(v.field)
}

/** One catalog layer, or the reason it is skipped. */
export function parseLayer(v: unknown, catalogUrl: string): GeoLayer | string {
  if (!isObj(v) || !isStr(v.id)) return 'no id'
  if (v.kind !== 'field' && v.kind !== 'image' && v.kind !== 'vector')
    return `kind ${String(v.kind)} has no renderer`
  const vector = layerVector(v)
  if (vector === null) return 'vector layer names no MVT layers'
  const box = bbox(v.bbox)
  if (!box) return 'bad bbox'
  const minZoom = isNum(v.minZoom) ? v.minZoom : 0
  const maxZoom = isNum(v.maxZoom) ? v.maxZoom : Number.NaN
  if (!Number.isFinite(maxZoom) || maxZoom < minZoom) return 'bad zoom range'
  const field = layerField(v)
  if (typeof field === 'string') return field
  const frames = parseFrames(v, { box, catalogUrl, minZoom, maxZoom })
  if (!frames.length) return 'no frames'
  const group = (GEO_GROUPS as readonly string[]).includes(String(v.group))
    ? (v.group as GeoGroup)
    : 'reference'
  const completeness = v.completeness === 'observed' || v.completeness === 'filled'
  return {
    id: v.id,
    title: str(v.title) ?? v.id,
    group,
    kind: v.kind,
    completeness: completeness ? (v.completeness as 'filled' | 'observed') : undefined,
    twin: str(v.twin),
    units: str(v.units),
    bbox: box,
    minZoom,
    maxZoom: Math.max(maxZoom, ...frames.flatMap(f => f.archives.map(a => a.maxZoom))),
    field,
    frames,
    cadence: str(v.cadence),
    source: parseSource(v.source),
    caveats: Array.isArray(v.caveats) ? v.caveats.filter(isStr) : [],
    vector,
    notForNavigation: v.notForNavigation !== false,
    sparse: v.sparse === true ? true : undefined,
  }
}

export function parseCatalog(body: unknown, url: string): GeoCatalog {
  if (!isObj(body) || !Array.isArray(body.layers)) throw new Error('catalog has no layers')
  if (body.schema !== undefined && body.schema !== 'narduk-geo-catalog/v2')
    throw new Error(`catalog schema ${String(body.schema)}`)
  const layers: GeoLayer[] = []
  const skipped: GeoCatalog['skipped'] = []
  for (const raw of body.layers) {
    const parsed = parseLayer(raw, url)
    const id = isObj(raw) && isStr(raw.id) ? raw.id : '?'
    if (typeof parsed === 'string') skipped.push({ id, reason: parsed })
    else if (layers.some(l => l.id === parsed.id)) skipped.push({ id, reason: 'duplicate id' })
    else layers.push(parsed)
  }
  const product = isStr(body.product) ? body.product : url
  return {
    product,
    title: isStr(body.title) ? body.title : product,
    releaseId: isStr(body.releaseId) ? body.releaseId : undefined,
    generatedAt: isStr(body.generatedAt) ? body.generatedAt : undefined,
    attribution: isStr(body.attribution) ? body.attribution : undefined,
    layers,
    skipped,
    url,
  }
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  // Revalidate every load (an ETag 304 is cheap): a product published minutes ago shows up.
  const res = await fetch(url, { signal, cache: 'no-cache' })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

/** Load every product the index lists; a failed product is reported, never fatal. */
export async function loadGeo(
  base: string,
  signal?: AbortSignal,
): Promise<{ catalogs: GeoCatalog[]; failed: string[] }> {
  const url = indexUrl(base, typeof window === 'undefined' ? undefined : window.location.href)
  const entries = parseIndex(await getJson(url, signal), url)
  const results = await Promise.allSettled(
    entries.map(async e => parseCatalog(await getJson(e.catalog, signal), e.catalog)),
  )
  const catalogs: GeoCatalog[] = []
  const failed: string[] = []
  for (const [i, r] of results.entries()) {
    if (r.status === 'fulfilled') {
      catalogs.push(r.value)
      for (const s of r.value.skipped)
        console.warn(`[narduk-maps] geo ${r.value.product}/${s.id} skipped: ${s.reason}`)
    } else failed.push(entries[i]!.id)
  }
  return { catalogs, failed }
}

/** Milliseconds since the epoch for a frame time (`YYYY-MM-DD` or `YYYY-MM-DDTHHZ`). */
export function frameMs(time: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2})(?::(\d{2}))?Z?)?$/.exec(time)
  if (!m) return Number.NaN
  return Date.parse(`${m[1]}T${m[2] ?? '00'}:${m[3] ?? '00'}:00Z`)
}

/** Frame spacing in days from an ISO 8601 duration (P1D, PT6H, PT1H); 1 when unknown. */
export function cadenceDays(cadence: string | undefined): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(cadence ?? '')
  if (!m) return 1
  const days = Number(m[1] ?? 0) + Number(m[2] ?? 0) / 24 + Number(m[3] ?? 0) / 1440
  return days > 0 ? days : 1
}
