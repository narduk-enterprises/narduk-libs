import { deflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { decodeTemporalChunk, type TemporalRasterManifest } from '../src/core/decode/temporal.js'

function buildChunk(options: {
  width: number
  height: number
  dates: string[]
  renderMode?: 'scalar' | 'rgb'
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
    for (let i = 0; i < pixelCount; i += 1) view.setUint16(i * 2, 32768, true)
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

  it('decodes a synthetic scalar chunk', async () => {
    const payload = buildChunk({ width: 2, height: 2, dates: ['2020-01-01'] })
    const frames = await decodeTemporalChunk(payload, baseManifest())
    expect(frames).toHaveLength(1)
    expect(frames[0]?.date).toBe('2020-01-01')
    expect(frames[0]?.width).toBe(2)
    expect(frames[0]?.height).toBe(2)
    expect(frames[0]?.renderMode).toBe('scalar')
    expect(frames[0]?.values).toBeInstanceOf(Uint16Array)
    expect(frames[0]?.mask).toHaveLength(4)
    expect(frames[0]?.values[0]).toBe(32768)
  })

  it('rejects dimension mismatch', async () => {
    const payload = buildChunk({ width: 2, height: 2, dates: ['2020-01-01'] })
    await expect(
      decodeTemporalChunk(payload, baseManifest({ width: 4, height: 4 })),
    ).rejects.toThrow('dimensions do not match')
  })
})
