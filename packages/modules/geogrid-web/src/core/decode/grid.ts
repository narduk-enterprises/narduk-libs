import type { GridBBox, GridRenderMode, GridScale, GridValueRange } from '../models.js'

/**
 * Decoder for the narduk-data `/grid` binary contract.
 *
 * ## Wire format
 *
 * ```text
 * bytes 0-3    uint32 LE   JSON header length
 * bytes 4..n   UTF-8 JSON  header (see GridBinaryHeader)
 * remainder    float32 LE  planeCount planes, plane-major then row-major
 * ```
 *
 * Row 0 is the northernmost row: `lat0` is the center of the first (top-left)
 * cell and `dy` is negative. Missing cells are `NaN` — the header spells this
 * as the **string** `"NaN"` in its `missing` field, which is a JSON limitation
 * rather than a numeric sentinel, and a header may instead name a real numeric
 * sentinel under `nodata`.
 *
 * The authoritative producer is narduk-data
 * `earth_data_pipeline/grid_artifact.py` (`publish_grid` / `pack_grid`).
 *
 * ## Provenance
 *
 * Ported from the two production decoders in `narduk-enterprises/gonogo`
 * (`src/client/map/grid.ts` and `src/worker/water/grid.ts`) and cross-checked
 * against the Swift consumer `GeoGridKit/Sources/GeoGridCore/GridBinaryDecoder.swift`.
 * Nothing about the format is re-derived here. The two fixtures in
 * `tests/fixtures/` are the same bytes GeoGridKit's `GridHeaderConformanceTests`
 * decodes, which makes this decoder the fourth leg of that cross-language
 * contract: Python producer, TypeScript producer (gonogo), Swift consumer, and
 * now this one.
 *
 * ## Strictness
 *
 * Strict about anything that determines memory layout — geometry, plane count,
 * payload length — because a payload one float short does not fail, it
 * silently shifts every subsequent row and plane into the wrong place. Lenient
 * about optional metadata: a missing `units`, `scale`, `releaseId`, or
 * `provenanceCounts` is a header from an older publisher, not a corrupt one,
 * and must not cost a consumer its data. (gonogo's worker throws on absent
 * release metadata; that is a policy its own release-boundary checks need, not
 * a property of the wire format, so it is surfaced here as a nullable field for
 * the caller to enforce.)
 */

/** Fail-closed caps for untrusted network payloads. Inherited from gonogo. */
export const GRID_DECODE_LIMITS = {
  maxHeaderBytes: 1_000_000,
  maxPlanes: 16,
  maxGridValues: 10_000_000,
} as const

const HEADER_PREFIX_BYTES = 4
const FLOAT_BYTES = 4

/** Whether this runtime's native byte order matches the payload's little-endian floats. */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

/**
 * The decoded JSON header.
 *
 * Wire keys are preserved verbatim (`dx`/`dy`, not `deltaLon`/`deltaLat`) so a
 * reader can hold this type and the raw JSON in their head at once; GeoGridKit
 * renames them in its `CodingKeys` and that rename has confused people.
 */
export interface GridBinaryHeader {
  layer: string
  /** Plane names in payload order, from `variables` or `planeOrder`; empty when unnamed. */
  variables: string[]
  planeCount: number
  bbox: GridBBox | null
  width: number
  height: number
  /** Longitude of the first column's cell center. */
  lon0: number
  /** Latitude of the first row's cell center (the northernmost row). */
  lat0: number
  /** Longitude step per column. */
  dx: number
  /** Latitude step per row; negative, because rows run north to south. */
  dy: number
  units: string | null
  scale: GridScale | null
  valueRange: GridValueRange | null
  renderMode: GridRenderMode | null
  validTime: string | null
  /** Numeric missing-value sentinel, or `'NaN'` when the publisher names none. */
  missing: number | 'NaN'
  releaseId: string | null
  generationId: string | null
  /** Provenance-class histogram, when the publisher stamps one. */
  provenanceCounts: Record<string, number> | null
  /** Every other header key, untouched, so a new field is readable before this type knows it. */
  extra: Record<string, unknown>
}

export interface GridScalarDataset {
  header: GridBinaryHeader
  /** One `Float32Array` per plane, row-major, `width * height` values each. */
  planes: Float32Array[]
  /**
   * One mask per plane: `1` where the cell carries a real value, `0` where it
   * is missing.
   *
   * Precomputed on the CPU because the GPU cannot be trusted to work it out.
   * GLSL's `isnan` is optimizer-fragile — it is a documented casualty of fast
   * -math on several drivers, where `x != x` folds to `false` and every hole in
   * the grid renders as whatever garbage the NaN bit pattern samples to. A
   * separate R8 mask texture is the portable answer, and building it here means
   * the CPU renderer and the WebGL renderer agree on which cells exist.
   */
  masks: Uint8Array[]
  /** Decimation stride reported by the server's `X-Grid-Stride`, when known. */
  stride: number | null
}

export interface DecodeGridOptions {
  /**
   * Accept a payload carrying *more* floats than the header declares.
   *
   * Defaults to `false`, matching the Swift decoder and gonogo's worker. The
   * gonogo *client* sets this deliberately: an interactive hover probe would
   * rather render a grid with unexplained trailing bytes than show nothing.
   */
  allowTrailingBytes?: boolean
  /** Decimation stride from `X-Grid-Stride`, recorded on the dataset. */
  stride?: number | null
}

export class GridDecodeError extends Error {
  override readonly name = 'GridDecodeError'
}

function fail(message: string): never {
  throw new GridDecodeError(message)
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail(`grid header ${label} must be a positive integer`)
  }
  return value
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`grid header ${label} must be a finite number`)
  }
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function optionalScale(value: unknown): GridScale | null {
  return value === 'linear' || value === 'log' ? value : null
}

function optionalRenderMode(value: unknown): GridRenderMode | null {
  return value === 'scalar' || value === 'rgb' ? value : null
}

function optionalValueRange(value: unknown): GridValueRange | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  const [lower, upper] = value
  if (typeof lower !== 'number' || typeof upper !== 'number') return null
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null
  return { lowerBound: lower, upperBound: upper }
}

function optionalBBox(value: unknown): GridBBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  if (!value.every((item) => typeof item === 'number' && Number.isFinite(item))) return null
  const [west, south, east, north] = value as [number, number, number, number]
  // Inverted is corruption, not an older publisher: it would flip the render.
  if (west > east || south > north) fail('grid header bbox is inverted')
  return [west, south, east, north]
}

function optionalProvenanceCounts(value: unknown): Record<string, number> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const counts: Record<string, number> = {}
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === 'number' && Number.isFinite(count)) counts[key] = count
  }
  return counts
}

function parseMissing(raw: Record<string, unknown>): number | 'NaN' {
  const value = raw.nodata ?? raw.missing
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return 'NaN'
}

/**
 * Plane names, from `variables` or `planeOrder`, whichever the publisher used.
 *
 * `grid_artifact.py` writes `variables`; the multi-plane water-quality and farm
 * publishers write `planeOrder`; a decoder that knows only one of them silently
 * loses plane addressing on half the estate's grids. Both must name every plane
 * exactly once, and an unnamed grid (neither key present) is legal — GeoGridKit
 * accepts it too, since geometry alone determines the layout.
 */
function parsePlaneNames(raw: Record<string, unknown>, planeCount: number): string[] {
  const source = raw.variables ?? raw.planeOrder
  if (source == null) return []

  if (
    !Array.isArray(source) ||
    source.length !== planeCount ||
    !source.every((item) => typeof item === 'string' && item.length > 0)
  ) {
    fail('grid header must name every plane exactly once')
  }
  const names = source as string[]
  if (new Set(names).size !== names.length) {
    fail('grid header plane names contain a duplicate')
  }
  return [...names]
}

function parseHeader(raw: Record<string, unknown>): GridBinaryHeader {
  const width = positiveInteger(raw.width, 'width')
  const height = positiveInteger(raw.height, 'height')
  const planeCount = positiveInteger(raw.planeCount ?? 1, 'planeCount')
  if (planeCount > GRID_DECODE_LIMITS.maxPlanes) {
    fail(`grid header planeCount exceeds ${GRID_DECODE_LIMITS.maxPlanes}`)
  }

  const valueCount = width * height * planeCount
  if (!Number.isSafeInteger(valueCount) || valueCount > GRID_DECODE_LIMITS.maxGridValues) {
    fail(`grid payload exceeds ${GRID_DECODE_LIMITS.maxGridValues} values`)
  }

  const dx = finiteNumber(raw.dx, 'dx')
  const dy = finiteNumber(raw.dy, 'dy')
  if (width > 1 && dx === 0) fail('grid header dx cannot be zero for multiple columns')
  if (height > 1 && dy === 0) fail('grid header dy cannot be zero for multiple rows')

  const {
    layer: _layer,
    variables: _variables,
    planeOrder: _planeOrder,
    planeCount: _planeCount,
    bbox: _bbox,
    width: _width,
    height: _height,
    lon0: _lon0,
    lat0: _lat0,
    dx: _dx,
    dy: _dy,
    units: _units,
    scale: _scale,
    valueRange: _valueRange,
    renderMode: _renderMode,
    validTime: _validTime,
    missing: _missing,
    nodata: _nodata,
    releaseId: _releaseId,
    generationId: _generationId,
    provenanceCounts: _provenanceCounts,
    ...extra
  } = raw

  return {
    layer: optionalString(raw.layer) ?? '',
    variables: parsePlaneNames(raw, planeCount),
    planeCount,
    bbox: optionalBBox(raw.bbox),
    width,
    height,
    lon0: finiteNumber(raw.lon0, 'lon0'),
    lat0: finiteNumber(raw.lat0, 'lat0'),
    dx,
    dy,
    units: optionalString(raw.units),
    scale: optionalScale(raw.scale),
    valueRange: optionalValueRange(raw.valueRange),
    renderMode: optionalRenderMode(raw.renderMode),
    validTime: optionalString(raw.validTime),
    missing: parseMissing(raw),
    releaseId: optionalString(raw.releaseId),
    generationId: optionalString(raw.generationId),
    provenanceCounts: optionalProvenanceCounts(raw.provenanceCounts),
    extra,
  }
}

/** Decode a `/grid` response body into planes plus per-plane finite masks. */
export function decodeGridBinary(
  buffer: ArrayBuffer,
  options: DecodeGridOptions = {},
): GridScalarDataset {
  if (buffer.byteLength < HEADER_PREFIX_BYTES) {
    fail('grid payload is missing its header length')
  }

  const view = new DataView(buffer)
  const headerLength = view.getUint32(0, true)
  if (headerLength < 2 || headerLength > GRID_DECODE_LIMITS.maxHeaderBytes) {
    fail('grid header length is out of range')
  }
  // getUint32 tops out at 4294967295, so this addition cannot itself overflow a
  // safe integer; the comparison catches a length that simply runs off the end.
  const headerEnd = HEADER_PREFIX_BYTES + headerLength
  if (headerEnd > buffer.byteLength) fail('grid header is truncated')

  let parsed: unknown
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        new Uint8Array(buffer, HEADER_PREFIX_BYTES, headerLength),
      ),
    )
  } catch (error: unknown) {
    throw new GridDecodeError('grid header is not valid UTF-8 JSON', { cause: error })
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('grid header must be a JSON object')
  }

  const header = parseHeader(parsed as Record<string, unknown>)
  const valuesPerPlane = header.width * header.height
  const valueCount = valuesPerPlane * header.planeCount
  const expectedBytes = valueCount * FLOAT_BYTES
  const payloadBytes = buffer.byteLength - headerEnd

  if (payloadBytes < expectedBytes) {
    fail(`grid payload is truncated: expected ${expectedBytes} bytes, received ${payloadBytes}`)
  }
  if (payloadBytes !== expectedBytes && !options.allowTrailingBytes) {
    fail(`grid payload length mismatch: expected ${expectedBytes} bytes, received ${payloadBytes}`)
  }

  const planes: Float32Array[] = []
  const masks: Uint8Array[] = []
  const missing = header.missing

  for (let planeIndex = 0; planeIndex < header.planeCount; planeIndex += 1) {
    const planeStart = headerEnd + planeIndex * valuesPerPlane * FLOAT_BYTES
    const values = readPlane(buffer, view, planeStart, valuesPerPlane)
    const mask = new Uint8Array(valuesPerPlane)
    for (let index = 0; index < valuesPerPlane; index += 1) {
      const value = values[index]!
      mask[index] = Number.isFinite(value) && !(missing !== 'NaN' && value === missing) ? 1 : 0
    }
    planes.push(values)
    masks.push(mask)
  }

  return { header, planes, masks, stride: options.stride ?? null }
}

/**
 * Copy one plane out of the response buffer.
 *
 * The float payload starts right after a JSON header whose length is whatever
 * the JSON happened to serialize to, so it is **not** 4-byte aligned in the
 * general case — `new Float32Array(buffer, start)` throws a `RangeError` on a
 * live response often enough that both gonogo decoders hit it. `slice` copies
 * the bytes into a fresh aligned buffer in one bulk operation; the per-element
 * `getFloat32` loop it replaces ran millions of times per hires probe.
 */
function readPlane(
  buffer: ArrayBuffer,
  view: DataView,
  start: number,
  count: number,
): Float32Array {
  if (LITTLE_ENDIAN) {
    return new Float32Array(buffer.slice(start, start + count * FLOAT_BYTES))
  }
  // No shipping browser takes this path; kept so a big-endian runtime is wrong
  // loudly rather than quietly byte-swapped.
  const values = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    values[index] = view.getFloat32(start + index * FLOAT_BYTES, true)
  }
  return values
}

/** Payload index of a named plane, or `null` when the grid does not carry it. */
export function planeIndexOf(dataset: GridScalarDataset, name: string): number | null {
  const index = dataset.header.variables.indexOf(name)
  return index < 0 ? null : index
}

/**
 * Geographic extent derived from the sample geometry, `[west, south, east, north]`.
 *
 * The twin of GeoGridKit's `GridHeader.bounds`, computed the same way: the last
 * cell center is `lon0 + (width - 1) * dx`, and each axis is ordered rather than
 * assumed, because `dy` is negative on every real grid.
 *
 * Not redundant with `header.bbox`. A header carries `bbox` independently and it
 * is **optional** here, so a publisher that omits it would otherwise leave a
 * decoded grid with no extent at all — and a renderer with no extent cannot
 * place a single pixel. Where both exist they should agree, which is the
 * cross-check GeoGridKit's conformance test makes and this package's test now
 * makes too.
 *
 * Note this spans cell *centers*, matching GeoGridKit — half a cell inside the
 * outer edge of the sampled area on each side.
 */
export function gridBounds(header: GridBinaryHeader): GridBBox {
  const lastLon = header.lon0 + Math.max(header.width - 1, 0) * header.dx
  const lastLat = header.lat0 + Math.max(header.height - 1, 0) * header.dy
  return [
    Math.min(header.lon0, lastLon),
    Math.min(header.lat0, lastLat),
    Math.max(header.lon0, lastLon),
    Math.max(header.lat0, lastLat),
  ]
}

/** The header key the server echoes its decimation stride in. */
export const GRID_STRIDE_HEADER = 'X-Grid-Stride'

export interface DecimatedGridUrlOptions {
  /** `[west, south, east, north]`, serialized at 4 decimal places. */
  bbox?: GridBBox
  /**
   * Cell budget. The server decimates by the smallest stride that fits the grid
   * inside it and reports that stride in `X-Grid-Stride`; a request under the
   * budget is served whole and carries no stride header at all.
   */
  maxCells?: number
  date?: string
}

/**
 * Build a `/grid` URL, optionally asking the server to decimate.
 *
 * ```ts
 * const url = decimatedGridUrl('https://data.example', 'kd490', { maxCells: 250_000 })
 * const response = await fetch(url)
 * const dataset = decodeGridBinary(await response.arrayBuffer(), {
 *   stride: readGridStride(response.headers),
 * })
 * ```
 */
export function decimatedGridUrl(
  baseUrl: string,
  layer: string,
  options: DecimatedGridUrlOptions = {},
): string {
  const url = new URL('/grid', baseUrl)
  url.searchParams.set('layer', layer)
  if (options.date != null) url.searchParams.set('date', options.date)
  if (options.bbox) {
    url.searchParams.set('bbox', options.bbox.map((value) => value.toFixed(4)).join(','))
  }
  if (options.maxCells != null) {
    if (!Number.isSafeInteger(options.maxCells) || options.maxCells < 1) {
      throw new RangeError('maxCells must be a positive integer')
    }
    url.searchParams.set('maxCells', String(options.maxCells))
  }
  return url.toString()
}

/**
 * Read `X-Grid-Stride` off a `/grid` response.
 *
 * `null` means the response was not decimated. Cross-origin callers only see
 * this header because the server names it in `Access-Control-Expose-Headers`;
 * if it reads `null` from a browser against a decimated response, that CORS
 * exposure is the thing to check.
 */
export function readGridStride(headers: Headers | Record<string, string>): number | null {
  const raw =
    typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get(GRID_STRIDE_HEADER)
      : ((headers as Record<string, string>)[GRID_STRIDE_HEADER] ??
        (headers as Record<string, string>)[GRID_STRIDE_HEADER.toLowerCase()])
  if (raw == null) return null
  const stride = Number(raw)
  return Number.isSafeInteger(stride) && stride >= 1 ? stride : null
}
