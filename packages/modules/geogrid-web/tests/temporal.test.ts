import { deflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import {
  decodeTemporalChunk,
  type TemporalRasterManifest,
} from '../src/core/decode/temporal.js'

function buildChunk(options: {
  width: number
  height: number
  dates: string[]
  renderMode?: 'scalar' | 'rgb'
  scalarFill?: number
}): ArrayBuffer {
  const { width, height, dates } = options
  const renderMode = options.renderMode ?? 'scalar'
  const pixelCount = width * height
  const frameCount = dates.length
  const planeCount = renderMode === 'rgb' ? 3 : 1
  const bytesPerSample = renderMode === 'rgb' ? 1 : 2
  const values = new Uint8Array(frameCount * pixelCount * planeCount * bytesPerSample)
  const masks = new Uint8Array(frameCount * pixelCount)
  masks.fill(1)
  if (renderMode === 'scalar') {
    const view = new DataView(values.buffer)
    const fill = options.scalarFill ?? 32768
    for (let f = 0; f < frameCount; f += 1) {
      for (let i = 0; i < pixelCount; i += 1) {
        view.setUint16((f * pixelCount + i) * 2, fill + f, true)
      }
    }
  } else {
    values.fill(128)
  }
  const raw = new Uint8Array(values.length + masks.length)
  raw.set(values, 0)
  raw.set(masks, values.length)
  const compressed = deflateSync(raw)
  const header = JSON.stringify({
    dates,
    frameCount,
    width,
    height,
    planeCount,
    renderMode,
  })
  const headerBytes = new TextEncoder().encode(header)
  const magic = new TextEncoder().encode('NARDUKTR1\0')
  const out = new Uint8Array(magic.length + 4 + headerBytes.length + compressed.length)
  out.set(magic, 0)
  new DataView(out.buffer).setUint32(magic.length, headerBytes.length, true)
  out.set(headerBytes, magic.length + 4)
  out.set(compressed, magic.length + 4 + headerBytes.length)
  return out.buffer
}

const baseManifest = (overrides: Partial<TemporalRasterManifest> = {}): TemporalRasterManifest => ({
  schema: 'earth-data-temporal-raster-v1',
  layer: 'test',
  format: 'narduktr1',
  compression: 'zlib',
  dtype: 'uint16',
  maskDtype: 'uint8',
  width: 2,
  height: 2,
  stride: 2,
  valueRange: [0, 1],
  scale: 'linear',
  bbox: [-100, 20, -90, 30],
  frameCount: 1,
  chunkFrames: 1,
  chunks: [{ firstFrame: 0, frameCount: 1, dates: ['2020-01-01'], url: 'chunk.bin' }],
  ...overrides,
})

describe('decodeTemporalChunk', () => {
  it('rejects non-temporal payloads before decompress', async () => {
    await expect(decodeTemporalChunk(new Uint8Array([1, 2, 3]).buffer, baseManifest())).rejects.toThrow(
      'Invalid temporal artifact magic',
    )
  })

  it('decodes a synthetic scalar chunk including odd widths', async () => {
    // width=3 exercises non-4-byte-aligned R8 mask rows and odd R16 scalar rows.
    const payload = buildChunk({ width: 3, height: 2, dates: ['2020-01-01'], scalarFill: 1000 })
    const frames = await decodeTemporalChunk(
      payload,
      baseManifest({ width: 3, height: 2, stride: 3 }),
    )
    expect(frames).toHaveLength(1)
    expect(frames[0]?.width).toBe(3)
    expect(frames[0]?.height).toBe(2)
    expect(frames[0]?.values).toBeInstanceOf(Uint16Array)
    expect(frames[0]?.values).toHaveLength(6)
    expect(frames[0]?.mask).toHaveLength(6)
    expect(frames[0]?.values[0]).toBe(1000)
    expect(frames[0]?.mask[0]).toBe(1)
  })

  it('decodes multi-frame scalar chunks with distinct sample values', async () => {
    const dates = ['2020-01-01', '2020-01-02']
    const payload = buildChunk({ width: 2, height: 2, dates, scalarFill: 10 })
    const frames = await decodeTemporalChunk(
      payload,
      baseManifest({
        frameCount: 2,
        chunkFrames: 2,
        chunks: [{ firstFrame: 0, frameCount: 2, dates, url: 'c.bin' }],
      }),
    )
    expect(frames).toHaveLength(2)
    expect(frames[0]?.values[0]).toBe(10)
    expect(frames[1]?.values[0]).toBe(11)
  })

  it('decodes RGB with width not multiple of 4', async () => {
    const payload = buildChunk({ width: 5, height: 1, dates: ['2020-01-01'], renderMode: 'rgb' })
    const frames = await decodeTemporalChunk(
      payload,
      baseManifest({
        width: 5,
        height: 1,
        stride: 5,
        dtype: 'uint8',
        renderMode: 'rgb',
        planeCount: 3,
      }),
    )
    expect(frames[0]?.renderMode).toBe('rgb')
    expect(frames[0]?.channels?.[0]).toHaveLength(5)
    expect(frames[0]?.channels?.[0]?.[0]).toBe(128)
    expect(frames[0]?.values).toBe(frames[0]?.channels?.[0])
    expect(frames[0]?.values.buffer).toBe(frames[0]?.channels?.[0].buffer)
  })

  it('rejects scalar uint8', async () => {
    const payload = buildChunk({ width: 2, height: 2, dates: ['2020-01-01'] })
    await expect(
      decodeTemporalChunk(payload, baseManifest({ dtype: 'uint8', renderMode: 'scalar' })),
    ).rejects.toThrow('uint16')
  })

  it('rejects dimension mismatch', async () => {
    const payload = buildChunk({ width: 2, height: 2, dates: ['2020-01-01'] })
    await expect(
      decodeTemporalChunk(payload, baseManifest({ width: 4, height: 4 })),
    ).rejects.toThrow('dimensions do not match')
  })
})
