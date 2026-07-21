import type { GridBBox, GridRenderMode, GridScale } from '../models.js'

const MAGIC = new TextEncoder().encode('NARDUKTR1\0')

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
  planeCount?: 1 | 3
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

export interface TemporalRasterFrame {
  date: string
  width: number
  height: number
  renderMode: GridRenderMode
  values: Uint16Array | Uint8Array
  channels?: [Uint8Array, Uint8Array, Uint8Array]
  mask: Uint8Array
}

export async function decodeTemporalChunk(
  payload: ArrayBuffer,
  manifest: TemporalRasterManifest,
): Promise<TemporalRasterFrame[]> {
  const bytes = new Uint8Array(payload)
  if (!startsWith(bytes, MAGIC)) throw new Error('Invalid temporal artifact magic')
  const view = new DataView(payload)
  let offset = MAGIC.byteLength
  const headerLength = view.getUint32(offset, true)
  offset += 4
  if (offset + headerLength > bytes.byteLength) {
    throw new Error('Temporal artifact header is truncated')
  }
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(offset, offset + headerLength))) as {
    dates: string[]
    frameCount: number
    width: number
    height: number
    planeCount?: number
    renderMode?: GridRenderMode
  }
  if (header.width !== manifest.width || header.height !== manifest.height) {
    throw new Error('Temporal artifact dimensions do not match manifest')
  }
  if (!Array.isArray(header.dates) || header.dates.length !== header.frameCount) {
    throw new Error('Temporal artifact header dates do not match frameCount')
  }
  offset += headerLength
  const compressed = bytes.subarray(offset)
  const raw = await inflate(compressed)
  const pixelCount = header.width * header.height
  const renderMode =
    manifest.renderMode ?? header.renderMode ?? (manifest.planeCount === 3 ? 'rgb' : 'scalar')
  const planeCount = manifest.planeCount ?? header.planeCount ?? (renderMode === 'rgb' ? 3 : 1)
  const bytesPerSample = manifest.dtype === 'uint8' || renderMode === 'rgb' ? 1 : 2
  const valuesBytes = header.frameCount * pixelCount * planeCount * bytesPerSample
  const values = raw.subarray(0, valuesBytes)
  const masks = raw.subarray(valuesBytes)
  if (values.length !== valuesBytes || masks.length !== header.frameCount * pixelCount) {
    throw new Error('Temporal artifact chunk is truncated')
  }
  return header.dates.map((date, frameIndex) => ({
    date,
    width: header.width,
    height: header.height,
    renderMode,
    values:
      renderMode === 'rgb'
        ? new Uint8Array(
            values.buffer,
            values.byteOffset + frameIndex * pixelCount * 3,
            pixelCount,
          ).slice()
        : new Uint16Array(
            values.buffer,
            values.byteOffset + frameIndex * pixelCount * 2,
            pixelCount,
          ).slice(),
    ...(renderMode === 'rgb'
      ? {
          channels: [
            new Uint8Array(
              values.buffer,
              values.byteOffset + frameIndex * pixelCount * 3,
              pixelCount,
            ).slice(),
            new Uint8Array(
              values.buffer,
              values.byteOffset + (frameIndex * 3 + 1) * pixelCount,
              pixelCount,
            ).slice(),
            new Uint8Array(
              values.buffer,
              values.byteOffset + (frameIndex * 3 + 2) * pixelCount,
              pixelCount,
            ).slice(),
          ] as [Uint8Array, Uint8Array, Uint8Array],
        }
      : {}),
    mask: masks.slice(frameIndex * pixelCount, (frameIndex + 1) * pixelCount),
  }))
}

async function inflate(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Temporal playback requires deflate decompression support (DecompressionStream)')
  }
  const ownedBuffer = new Uint8Array(compressed).buffer as ArrayBuffer
  const stream = new Blob([ownedBuffer]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => value[index] === byte)
}
