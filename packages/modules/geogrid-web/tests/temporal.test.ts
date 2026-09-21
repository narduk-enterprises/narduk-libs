import { deflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import {
  decodeTemporalChunk,
  TEMPORAL_RGB_COMPOSITION_DESCRIPTOR,
  type TemporalRasterManifest,
  type TemporalRgbCompositionV2AreaAnchorDescriptor,
} from '../src/core/decode/temporal.js'

const PRODUCER_V2_DESCRIPTOR = {
  version: 'base-observed-confidence-v2-area-anchor',
  blendSpace: 'linear-srgb',
  baseChannels: [0, 1, 2],
  observedChannels: [3, 4, 5],
  confidenceChannel: 6,
  baseMask: 0,
  observedMask: 1,
  overviewAggregation: {
    maxZoom: 7,
    method: 'area-weighted-valid-water-support',
    supportModulatesWeight: true,
  },
  scaleAwareRecipe: {
    version: 'water-quality-v2-scale-aware-v2',
    zoomWeights: { '0-7': 0.2, '8': 0.25, '9': 0.4, '10+': 1 },
  },
  zoomWeights: [
    { maxZoom: 7, weight: 0.2 },
    { zoom: 8, weight: 0.25 },
    { zoom: 9, weight: 0.4 },
    { minZoom: 10, weight: 1 },
  ],
} as const satisfies TemporalRgbCompositionV2AreaAnchorDescriptor

function packChunk(header: Record<string, unknown>, raw: Uint8Array): ArrayBuffer {
  const compressed = deflateSync(raw)
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const magic = new TextEncoder().encode('NARDUKTR1\0')
  const out = new Uint8Array(magic.length + 4 + headerBytes.length + compressed.length)
  out.set(magic, 0)
  new DataView(out.buffer).setUint32(magic.length, headerBytes.length, true)
  out.set(headerBytes, magic.length + 4)
  out.set(compressed, magic.length + 4 + headerBytes.length)
  return out.buffer
}

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
  return packChunk(
    {
      dates,
      frameCount,
      width,
      height,
      planeCount,
      renderMode,
    },
    raw,
  )
}

function buildComposedRgbChunk(
  options: {
    planeCount?: number
    maskCount?: number
    extraRawBytes?: number
    omitHeaderLayout?: boolean
  } = {},
): ArrayBuffer {
  const width = 2
  const height = 1
  const planeCount = options.planeCount ?? 7
  const maskCount = options.maskCount ?? 2
  const pixels = width * height
  const values = new Uint8Array(planeCount * pixels)
  const planes = [
    [10, 11],
    [20, 21],
    [30, 31],
    [110, 111],
    [120, 121],
    [130, 131],
    [128, 255],
  ]
  for (let plane = 0; plane < Math.min(planeCount, planes.length); plane += 1) {
    values.set(planes[plane]!, plane * pixels)
  }
  const masks = new Uint8Array(maskCount * pixels)
  if (maskCount >= 1) masks.set([1, 0], 0)
  if (maskCount >= 2) masks.set([0, 1], pixels)
  const raw = new Uint8Array(values.length + masks.length + (options.extraRawBytes ?? 0))
  raw.set(values)
  raw.set(masks, values.length)
  return packChunk(
    {
      dates: ['2020-01-01'],
      frameCount: 1,
      width,
      height,
      ...(options.omitHeaderLayout ? {} : { planeCount, maskCount }),
      renderMode: 'rgb',
    },
    raw,
  )
}

const composedManifest = (
  overrides: Partial<TemporalRasterManifest> = {},
): TemporalRasterManifest =>
  baseManifest({
    width: 2,
    height: 1,
    stride: 1,
    dtype: 'uint8',
    renderMode: 'rgb',
    planeCount: 7,
    maskCount: 2,
    rgbComposition: TEMPORAL_RGB_COMPOSITION_DESCRIPTOR,
    ...overrides,
  })

const composedV2Manifest = (
  overrides: Partial<TemporalRasterManifest> = {},
): TemporalRasterManifest =>
  composedManifest({
    rgbComposition: PRODUCER_V2_DESCRIPTOR,
    ...overrides,
  })

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
    await expect(
      decodeTemporalChunk(new Uint8Array([1, 2, 3]).buffer, baseManifest()),
    ).rejects.toThrow('Invalid temporal artifact magic')
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
    expect(frames[0]?.rgbComposition).toBeUndefined()
  })

  it('decodes base RGB, observed RGB, confidence and two distinct masks', async () => {
    const [frame] = await decodeTemporalChunk(buildComposedRgbChunk(), composedManifest())
    const composition = frame?.rgbComposition

    expect(frame?.channels?.map((plane) => Array.from(plane))).toEqual([
      [10, 11],
      [20, 21],
      [30, 31],
    ])
    expect(composition?.observedChannels.map((plane) => Array.from(plane))).toEqual([
      [110, 111],
      [120, 121],
      [130, 131],
    ])
    expect(Array.from(composition?.confidence ?? [])).toEqual([128, 255])
    expect(Array.from(composition?.baseMask ?? [])).toEqual([1, 0])
    expect(Array.from(composition?.observedMask ?? [])).toEqual([0, 1])
    expect(frame?.values).toBe(frame?.channels?.[0])
    expect(frame?.mask).toBe(composition?.baseMask)
    expect(frame?.channels).toBe(composition?.baseChannels)
  })

  it('decodes the canonical bounded z9 weight emitted by the water-quality producer', async () => {
    const decoded = decodeTemporalChunk(buildComposedRgbChunk(), composedManifest())
    await expect(decoded).resolves.toHaveLength(1)
    expect(TEMPORAL_RGB_COMPOSITION_DESCRIPTOR.zoomWeights[2].weight).toBe(0.4)
  })

  it('accepts the literal v2 area-anchor contract and propagates its render version', async () => {
    const [frame] = await decodeTemporalChunk(buildComposedRgbChunk(), composedV2Manifest())
    expect(frame?.rgbComposition?.version).toBe('base-observed-confidence-v2-area-anchor')
  })

  /* eslint-disable @typescript-eslint/no-explicit-any -- each mutator reaches into a
     structuredClone of the descriptor fixture through a different dynamic property path
     to exercise one rejection branch. A discriminated mutator type was considered and
     rejected (narduk-libs#144): the seven paths touch six different nested shapes, so a
     real union would mean duplicating slices of the production descriptor type per
     mutation, or a cast at the call site exactly as loose as this `any` -- test-only
     churn for no runtime benefit, since the fixture and the mutators live and change
     together in this one block. Kept as a scoped, permanent exception; not tracked as
     open work. */
  it.each([
    [
      'method',
      (descriptor: Record<string, any>) => {
        descriptor.overviewAggregation.method = 'point'
      },
    ],
    [
      'max zoom',
      (descriptor: Record<string, any>) => {
        descriptor.overviewAggregation.maxZoom = 8
      },
    ],
    [
      'support flag',
      (descriptor: Record<string, any>) => {
        descriptor.overviewAggregation.supportModulatesWeight = false
      },
    ],
    [
      'recipe version',
      (descriptor: Record<string, any>) => {
        descriptor.scaleAwareRecipe.version = 'water-quality-v2-scale-aware-v1'
      },
    ],
    [
      'recipe weight',
      (descriptor: Record<string, any>) => {
        descriptor.scaleAwareRecipe.zoomWeights['0-7'] = 0
      },
    ],
    [
      'anchor weight',
      (descriptor: Record<string, any>) => {
        descriptor.zoomWeights[0].weight = 0
      },
    ],
    [
      'unknown metadata',
      (descriptor: Record<string, any>) => {
        descriptor.unrecognized = true
      },
    ],
  ])('rejects altered v2 %s metadata', async (_label, alter) => {
    const descriptor = structuredClone(PRODUCER_V2_DESCRIPTOR) as unknown as Record<string, any>
    /* eslint-enable @typescript-eslint/no-explicit-any -- scope ends with the fixture setup above */
    alter(descriptor)
    await expect(
      decodeTemporalChunk(
        buildComposedRgbChunk(),
        composedV2Manifest({
          rgbComposition: descriptor as unknown as NonNullable<
            TemporalRasterManifest['rgbComposition']
          >,
        }),
      ),
    ).rejects.toThrow('composition descriptor is invalid')
  })

  it('rejects the superseded z9 weight instead of weakening descriptor validation', async () => {
    const unsupportedDescriptor = {
      ...TEMPORAL_RGB_COMPOSITION_DESCRIPTOR,
      zoomWeights: [
        { maxZoom: 7, weight: 0 },
        { zoom: 8, weight: 0.25 },
        { zoom: 9, weight: 0.6 },
        { minZoom: 10, weight: 1 },
      ],
    }
    await expect(
      decodeTemporalChunk(
        buildComposedRgbChunk(),
        composedManifest({
          rgbComposition: unsupportedDescriptor as unknown as NonNullable<
            TemporalRasterManifest['rgbComposition']
          >,
        }),
      ),
    ).rejects.toThrow('composition descriptor is invalid')
  })

  it('rejects composed RGB unless both the manifest and chunk declare 7 planes and 2 masks', async () => {
    await expect(
      decodeTemporalChunk(
        buildComposedRgbChunk({ planeCount: 3, maskCount: 1 }),
        composedManifest({ planeCount: 3, maskCount: 1 }),
      ),
    ).rejects.toThrow('manifest must declare rgb, 7 planes, and 2 masks')
    await expect(
      decodeTemporalChunk(buildComposedRgbChunk(), composedManifest({ planeCount: 3 })),
    ).rejects.toThrow('planeCount does not match manifest')
    await expect(
      decodeTemporalChunk(buildComposedRgbChunk({ omitHeaderLayout: true }), composedManifest()),
    ).rejects.toThrow('chunk header must mirror planeCount and maskCount')
    const missingManifestLayout = composedManifest()
    delete missingManifestLayout.planeCount
    delete missingManifestLayout.maskCount
    await expect(
      decodeTemporalChunk(buildComposedRgbChunk(), missingManifestLayout),
    ).rejects.toThrow('manifest must declare rgb, 7 planes, and 2 masks')
  })

  it('rejects any composition descriptor that tries to redefine the fixed wire mapping', async () => {
    const badComposition = {
      ...TEMPORAL_RGB_COMPOSITION_DESCRIPTOR,
      observedChannels: [3, 4, 6],
    }
    await expect(
      decodeTemporalChunk(
        buildComposedRgbChunk(),
        composedManifest({
          rgbComposition: badComposition as unknown as NonNullable<
            TemporalRasterManifest['rgbComposition']
          >,
        }),
      ),
    ).rejects.toThrow('composition descriptor is invalid')
  })

  it('rejects a composition descriptor on a scalar manifest instead of ignoring it', async () => {
    await expect(
      decodeTemporalChunk(
        buildChunk({ width: 2, height: 2, dates: ['2020-01-01'] }),
        baseManifest({ rgbComposition: TEMPORAL_RGB_COMPOSITION_DESCRIPTOR }),
      ),
    ).rejects.toThrow('requires renderMode rgb')
  })

  it('rejects unsupported runtime manifest metadata before decompression', async () => {
    const payload = buildChunk({ width: 2, height: 2, dates: ['2020-01-01'] })
    await expect(
      decodeTemporalChunk(payload, baseManifest({ compression: 'brotli' as unknown as 'zlib' })),
    ).rejects.toThrow('compression is unsupported')
  })

  it('stops inflation when bytes exceed the declared layout', async () => {
    await expect(
      decodeTemporalChunk(buildComposedRgbChunk({ extraRawBytes: 1 }), composedManifest()),
    ).rejects.toThrow('exceeds declared layout')
  })

  it('rejects a composed layout whose declared decoded bytes exceed the cap before inflate', async () => {
    const width = 8192
    const height = 8192
    const payload = packChunk(
      {
        dates: ['2020-01-01'],
        frameCount: 1,
        width,
        height,
        planeCount: 7,
        maskCount: 2,
        renderMode: 'rgb',
      },
      new Uint8Array(),
    )
    await expect(decodeTemporalChunk(payload, composedManifest({ width, height }))).rejects.toThrow(
      'exceeds size limit',
    )
  })

  it('rejects non-integer header geometry before allocation', async () => {
    const payload = packChunk(
      {
        dates: ['2020-01-01'],
        frameCount: 1,
        width: 1.5,
        height: 1,
        planeCount: 1,
        renderMode: 'scalar',
      },
      new Uint8Array(),
    )
    await expect(
      decodeTemporalChunk(payload, baseManifest({ width: 1.5, height: 1 })),
    ).rejects.toThrow('dimensions are out of allowed range')
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
