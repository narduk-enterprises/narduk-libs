import type { GridBBox, GridRenderMode, GridRgbComposition, GridScale } from '../models.js'

const MAGIC = new TextEncoder().encode('NARDUKTR1\0')

/** Safety caps for untrusted network chunks (fail closed). */
export const TEMPORAL_DECODE_LIMITS = {
  maxHeaderBytes: 256 * 1024,
  maxCompressedBytes: 512 * 1024 * 1024,
  maxWidth: 16_384,
  maxHeight: 16_384,
  maxFrames: 512,
  maxPixelsPerFrame: 64 * 1024 * 1024,
  maxDecompressedBytes: 512 * 1024 * 1024,
} as const

/** Fixed semantic order for the additive seven-plane RGB payload. */
export const TEMPORAL_RGB_COMPOSITION_VERSION = 'base-observed-confidence-v1' as const

export interface TemporalRgbCompositionDescriptor {
  version: typeof TEMPORAL_RGB_COMPOSITION_VERSION
  blendSpace: 'linear-srgb'
  baseChannels: readonly [0, 1, 2]
  observedChannels: readonly [3, 4, 5]
  confidenceChannel: 6
  baseMask: 0
  observedMask: 1
  zoomWeights: readonly [
    { maxZoom: 7; weight: 0 },
    { zoom: 8; weight: 0.25 },
    { zoom: 9; weight: 0.4 },
    { minZoom: 10; weight: 1 },
  ]
}

/** Canonical self-description emitted by the producer and validated here. */
export const TEMPORAL_RGB_COMPOSITION_DESCRIPTOR: TemporalRgbCompositionDescriptor = {
  version: TEMPORAL_RGB_COMPOSITION_VERSION,
  blendSpace: 'linear-srgb',
  baseChannels: [0, 1, 2],
  observedChannels: [3, 4, 5],
  confidenceChannel: 6,
  baseMask: 0,
  observedMask: 1,
  zoomWeights: [
    { maxZoom: 7, weight: 0 },
    { zoom: 8, weight: 0.25 },
    { zoom: 9, weight: 0.4 },
    { minZoom: 10, weight: 1 },
  ],
}

export interface TemporalChunkDescriptor {
  firstFrame: number
  frameCount: number
  dates: string[]
  url: string
}

export interface CoastlineStencilDescriptor {
  url: string
  bbox: GridBBox
  resolutionMeters?: number
  maskVersion?: string
}

/** Wire format: `earth-data-temporal-raster-v1` (earthdata / narduk-data). */
export interface TemporalRasterManifest {
  schema: 'earth-data-temporal-raster-v1'
  layer: string
  format: string
  compression: 'zlib'
  renderMode?: GridRenderMode
  planeCount?: 1 | 3 | 7
  maskCount?: 1 | 2
  rgbComposition?: TemporalRgbCompositionDescriptor
  dtype: 'uint16' | 'uint8'
  maskDtype: 'uint8'
  width: number
  height: number
  stride: number
  valueRange: [number, number]
  scale?: GridScale | string
  bbox: GridBBox
  frameCount: number
  chunkFrames: number
  chunks: TemporalChunkDescriptor[]
  coastlineStencil?: CoastlineStencilDescriptor
}

/**
 * One decoded temporal frame.
 *
 * Sample planes are immutable after decode. For RGB frames, `values` is the
 * scalar-compatibility view of red and aliases `channels[0]`.
 */
export interface TemporalRasterFrame {
  date: string
  width: number
  height: number
  renderMode: GridRenderMode
  values: Uint16Array | Uint8Array
  channels?: [Uint8Array, Uint8Array, Uint8Array]
  mask: Uint8Array
  rgbComposition?: GridRgbComposition
}

interface TemporalChunkHeader {
  dates: string[]
  frameCount: number
  width: number
  height: number
  planeCount?: number
  maskCount?: number
  renderMode?: GridRenderMode
}

export async function decodeTemporalChunk(
  payload: ArrayBuffer,
  manifest: TemporalRasterManifest,
): Promise<TemporalRasterFrame[]> {
  validateManifestEnvelope(manifest)
  const bytes = new Uint8Array(payload)
  if (!startsWith(bytes, MAGIC)) throw new Error('Invalid temporal artifact magic')
  if (bytes.byteLength < MAGIC.byteLength + 4) {
    throw new Error('Temporal artifact header length is truncated')
  }
  const view = new DataView(payload)
  let offset = MAGIC.byteLength
  const headerLength = view.getUint32(offset, true)
  offset += 4
  if (headerLength <= 0 || headerLength > TEMPORAL_DECODE_LIMITS.maxHeaderBytes) {
    throw new Error('Temporal artifact header length is invalid')
  }
  if (offset + headerLength > bytes.byteLength) {
    throw new Error('Temporal artifact header is truncated')
  }
  const header = parseHeader(bytes.subarray(offset, offset + headerLength))
  if (header.width !== manifest.width || header.height !== manifest.height) {
    throw new Error('Temporal artifact dimensions do not match manifest')
  }
  if (
    !Number.isSafeInteger(header.width) ||
    !Number.isSafeInteger(header.height) ||
    header.width <= 0 ||
    header.height <= 0 ||
    header.width > TEMPORAL_DECODE_LIMITS.maxWidth ||
    header.height > TEMPORAL_DECODE_LIMITS.maxHeight
  ) {
    throw new Error('Temporal artifact dimensions are out of allowed range')
  }
  if (
    header.dates.length !== header.frameCount ||
    header.dates.some((date) => date.length === 0 || date.length > 128)
  ) {
    throw new Error('Temporal artifact header dates do not match frameCount')
  }
  if (
    !Number.isSafeInteger(header.frameCount) ||
    header.frameCount <= 0 ||
    header.frameCount > TEMPORAL_DECODE_LIMITS.maxFrames
  ) {
    throw new Error('Temporal artifact frameCount is out of allowed range')
  }
  const pixelCount = header.width * header.height
  if (pixelCount > TEMPORAL_DECODE_LIMITS.maxPixelsPerFrame) {
    throw new Error('Temporal artifact pixel count is out of allowed range')
  }
  offset += headerLength
  const compressed = bytes.subarray(offset)
  if (
    compressed.byteLength <= 0 ||
    compressed.byteLength > TEMPORAL_DECODE_LIMITS.maxCompressedBytes
  ) {
    throw new Error('Temporal artifact compressed payload is out of allowed range')
  }
  const renderMode =
    manifest.renderMode ??
    header.renderMode ??
    (manifest.planeCount === 3 || manifest.planeCount === 7 ? 'rgb' : 'scalar')
  if (header.renderMode !== undefined && header.renderMode !== renderMode) {
    throw new Error('Temporal artifact renderMode does not match manifest')
  }
  if (renderMode === 'scalar' && manifest.dtype === 'uint8') {
    throw new Error('Scalar temporal frames require dtype uint16 (uint8 scalar is not supported)')
  }
  if (renderMode === 'rgb' && manifest.dtype !== 'uint8') {
    throw new Error('RGB temporal frames require dtype uint8')
  }
  const planeCount = manifest.planeCount ?? header.planeCount ?? (renderMode === 'rgb' ? 3 : 1)
  if (header.planeCount !== undefined && header.planeCount !== planeCount) {
    throw new Error('Temporal artifact planeCount does not match manifest')
  }
  const maskCount = manifest.maskCount ?? header.maskCount ?? 1
  if (header.maskCount !== undefined && header.maskCount !== maskCount) {
    throw new Error('Temporal artifact maskCount does not match manifest')
  }
  const rgbComposition = parseRgbComposition(manifest.rgbComposition)
  if (rgbComposition !== null && renderMode !== 'rgb') {
    throw new Error('Temporal RGB composition requires renderMode rgb')
  }
  if (
    rgbComposition !== null &&
    (manifest.renderMode !== 'rgb' || manifest.planeCount !== 7 || manifest.maskCount !== 2)
  ) {
    throw new Error('Temporal RGB composition manifest must declare rgb, 7 planes, and 2 masks')
  }
  if (
    rgbComposition !== null &&
    (header.planeCount !== manifest.planeCount || header.maskCount !== manifest.maskCount)
  ) {
    throw new Error('Temporal RGB composition chunk header must mirror planeCount and maskCount')
  }
  if (renderMode === 'rgb' && rgbComposition === null && planeCount !== 3) {
    throw new Error('Legacy RGB temporal frames require planeCount 3')
  }
  if (renderMode === 'rgb' && rgbComposition !== null && (planeCount !== 7 || maskCount !== 2)) {
    throw new Error('Composed RGB temporal frames require planeCount 7 and maskCount 2')
  }
  if (renderMode === 'scalar' && planeCount !== 1) {
    throw new Error('Scalar temporal frames require planeCount 1')
  }
  if ((renderMode === 'scalar' || rgbComposition === null) && maskCount !== 1) {
    throw new Error('Legacy temporal frames require maskCount 1')
  }
  const bytesPerSample = renderMode === 'rgb' ? 1 : 2
  const valuesBytes = checkedProduct(
    header.frameCount,
    pixelCount,
    planeCount,
    bytesPerSample,
  )
  const masksBytes = checkedProduct(header.frameCount, pixelCount, maskCount)
  const expectedDecompressed = valuesBytes + masksBytes
  if (
    !Number.isSafeInteger(expectedDecompressed) ||
    expectedDecompressed > TEMPORAL_DECODE_LIMITS.maxDecompressedBytes
  ) {
    throw new Error('Temporal artifact decompressed payload exceeds size limit')
  }
  const raw = await inflate(compressed, expectedDecompressed)
  const values = raw.subarray(0, valuesBytes)
  const masks = raw.subarray(valuesBytes)
  if (values.length !== valuesBytes || masks.length !== masksBytes) {
    throw new Error('Temporal artifact chunk is truncated')
  }
  return header.dates.map((date, frameIndex) => {
    const frameValuesOffset = values.byteOffset + frameIndex * pixelCount * planeCount
    const frameMasksOffset = frameIndex * pixelCount * maskCount
    const mask = masks.slice(frameMasksOffset, frameMasksOffset + pixelCount)
    if (renderMode === 'rgb') {
      const channels: [Uint8Array, Uint8Array, Uint8Array] = [
        new Uint8Array(values.buffer, frameValuesOffset, pixelCount).slice(),
        new Uint8Array(values.buffer, frameValuesOffset + pixelCount, pixelCount).slice(),
        new Uint8Array(values.buffer, frameValuesOffset + pixelCount * 2, pixelCount).slice(),
      ]
      if (rgbComposition) {
        const observedChannels: [Uint8Array, Uint8Array, Uint8Array] = [
          new Uint8Array(values.buffer, frameValuesOffset + pixelCount * 3, pixelCount).slice(),
          new Uint8Array(values.buffer, frameValuesOffset + pixelCount * 4, pixelCount).slice(),
          new Uint8Array(values.buffer, frameValuesOffset + pixelCount * 5, pixelCount).slice(),
        ]
        const confidence = new Uint8Array(
          values.buffer,
          frameValuesOffset + pixelCount * 6,
          pixelCount,
        ).slice()
        const observedMask = masks.slice(
          frameMasksOffset + pixelCount,
          frameMasksOffset + pixelCount * 2,
        )
        const composition: GridRgbComposition = {
          baseChannels: channels,
          observedChannels,
          confidence,
          baseMask: mask,
          observedMask,
        }
        return {
          date,
          width: header.width,
          height: header.height,
          renderMode,
          values: channels[0],
          channels,
          mask,
          rgbComposition: composition,
        }
      }
      return {
        date,
        width: header.width,
        height: header.height,
        renderMode,
        // `values` is the scalar compatibility plane. RGB renderers consume
        // `channels`, and every package path treats decoded planes as immutable,
        // so the red channel can satisfy both contracts without a second copy.
        values: channels[0],
        channels,
        mask,
      }
    }
    return {
      date,
      width: header.width,
      height: header.height,
      renderMode,
      values: new Uint16Array(
        values.buffer,
        values.byteOffset + frameIndex * pixelCount * 2,
        pixelCount,
      ).slice(),
      mask,
    }
  })
}

async function inflate(compressed: Uint8Array, expectedBytes: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Temporal playback requires deflate decompression support (DecompressionStream)')
  }
  const ownedBuffer = new Uint8Array(compressed).buffer as ArrayBuffer
  const stream = new Blob([ownedBuffer]).stream().pipeThrough(new DecompressionStream('deflate'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > expectedBytes) {
        await reader.cancel('Temporal artifact exceeds declared layout')
        throw new Error('Temporal artifact decompressed payload exceeds declared layout')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function parseHeader(bytes: Uint8Array): TemporalChunkHeader {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error: unknown) {
    throw new Error('Temporal artifact header is not valid JSON', { cause: error })
  }
  if (!isRecord(parsed)) throw new Error('Temporal artifact header must be an object')
  const dates = parsed.dates
  if (!Array.isArray(dates) || !dates.every((date): date is string => typeof date === 'string')) {
    throw new Error('Temporal artifact header dates must be strings')
  }
  const renderMode = parsed.renderMode
  if (renderMode !== undefined && renderMode !== 'scalar' && renderMode !== 'rgb') {
    throw new Error('Temporal artifact renderMode is invalid')
  }
  return {
    dates,
    frameCount: numberField(parsed, 'frameCount'),
    width: numberField(parsed, 'width'),
    height: numberField(parsed, 'height'),
    ...(parsed.planeCount !== undefined ? { planeCount: numberField(parsed, 'planeCount') } : {}),
    ...(parsed.maskCount !== undefined ? { maskCount: numberField(parsed, 'maskCount') } : {}),
    ...(renderMode !== undefined ? { renderMode } : {}),
  }
}

function parseRgbComposition(
  descriptor: unknown,
): TemporalRgbCompositionDescriptor | null {
  if (descriptor === undefined) return null
  if (
    !isRecord(descriptor) ||
    descriptor.version !== TEMPORAL_RGB_COMPOSITION_VERSION ||
    descriptor.blendSpace !== 'linear-srgb' ||
    !hasNumberTuple(descriptor.baseChannels, [0, 1, 2]) ||
    !hasNumberTuple(descriptor.observedChannels, [3, 4, 5]) ||
    descriptor.confidenceChannel !== 6 ||
    descriptor.baseMask !== 0 ||
    descriptor.observedMask !== 1 ||
    !hasCanonicalZoomWeights(descriptor.zoomWeights)
  ) {
    throw new Error('Temporal RGB composition descriptor is invalid')
  }
  return TEMPORAL_RGB_COMPOSITION_DESCRIPTOR
}

function validateManifestEnvelope(manifest: TemporalRasterManifest): void {
  if (!isRecord(manifest)) throw new Error('Temporal manifest must be an object')
  if (manifest.schema !== 'earth-data-temporal-raster-v1') {
    throw new Error('Temporal manifest schema is unsupported')
  }
  if (manifest.compression !== 'zlib') {
    throw new Error('Temporal manifest compression is unsupported')
  }
  if (manifest.dtype !== 'uint8' && manifest.dtype !== 'uint16') {
    throw new Error('Temporal manifest dtype is unsupported')
  }
  if (manifest.maskDtype !== 'uint8') {
    throw new Error('Temporal manifest maskDtype is unsupported')
  }
  if (
    manifest.renderMode !== undefined &&
    manifest.renderMode !== 'scalar' &&
    manifest.renderMode !== 'rgb'
  ) {
    throw new Error('Temporal manifest renderMode is invalid')
  }
}

function hasNumberTuple(value: unknown, expected: readonly number[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  )
}

function hasCanonicalZoomWeights(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(isRecord)) return false
  return (
    value[0]?.maxZoom === 7 &&
    value[0]?.weight === 0 &&
    value[1]?.zoom === 8 &&
    value[1]?.weight === 0.25 &&
    value[2]?.zoom === 9 &&
    value[2]?.weight === 0.4 &&
    value[3]?.minZoom === 10 &&
    value[3]?.weight === 1
  )
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value !== 'number') throw new Error(`Temporal artifact ${field} must be a number`)
  return value
}

function checkedProduct(...factors: number[]): number {
  let product = 1
  for (const factor of factors) {
    product *= factor
    if (!Number.isSafeInteger(product)) {
      throw new Error('Temporal artifact declared layout exceeds safe integer range')
    }
  }
  return product
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => value[index] === byte)
}
