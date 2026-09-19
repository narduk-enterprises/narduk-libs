/**
 * A minimal Mapbox Vector Tile encoder, for tests only.
 *
 * The decoder is worth testing against real protobuf rather than a stub: the
 * parts that break are the zigzag-delta geometry walk and the tags/values
 * indirection, and neither exists in a hand-built object. Encoding here rather
 * than checking in a binary fixture keeps the bytes readable in review, and
 * costs one small function.
 *
 * Spec: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 */
import { PbfWriter } from 'pbf'

export type FixtureValue = boolean | number | string

export interface FixtureFeature {
  /** 1 = point, 2 = linestring, 3 = polygon. */
  type: 1 | 2 | 3
  lines: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>
  properties?: Record<string, FixtureValue>
}

export interface FixtureLayer {
  extent?: number
  features: readonly FixtureFeature[]
  name: string
}

const MOVE_TO = 1
const LINE_TO = 2

function zigzag(value: number): number {
  return (value << 1) ^ (value >> 31)
}

/** Commands and parameters for one feature's geometry, spec section 4.3. */
function encodeGeometry(lines: FixtureFeature['lines'], type: FixtureFeature['type']): number[] {
  const geometry: number[] = []
  let cursorX = 0
  let cursorY = 0
  for (const line of lines) {
    if (line.length === 0) continue
    const [first, ...rest] = line
    if (!first) continue
    geometry.push((MOVE_TO & 0x7) | (1 << 3), zigzag(first.x - cursorX), zigzag(first.y - cursorY))
    cursorX = first.x
    cursorY = first.y
    if (type === 1 || rest.length === 0) continue
    geometry.push((LINE_TO & 0x7) | (rest.length << 3))
    for (const point of rest) {
      geometry.push(zigzag(point.x - cursorX), zigzag(point.y - cursorY))
      cursorX = point.x
      cursorY = point.y
    }
  }
  return geometry
}

function writeValue(value: FixtureValue, pbf: PbfWriter) {
  if (typeof value === 'string') pbf.writeStringField(1, value)
  else if (typeof value === 'boolean') pbf.writeBooleanField(7, value)
  else if (Number.isInteger(value) && value >= 0) pbf.writeVarintField(5, value)
  else pbf.writeDoubleField(3, value)
}

function writeLayer(layer: FixtureLayer, pbf: PbfWriter) {
  pbf.writeVarintField(15, 2)
  pbf.writeStringField(1, layer.name)
  pbf.writeVarintField(5, layer.extent ?? 4096)

  const keys: string[] = []
  const values: FixtureValue[] = []
  const keyIndex = new Map<string, number>()
  const valueIndex = new Map<string, number>()

  const tagsFor = (properties: Record<string, FixtureValue> | undefined) => {
    const tags: number[] = []
    for (const [key, value] of Object.entries(properties ?? {})) {
      let k = keyIndex.get(key)
      if (k === undefined) {
        k = keys.length
        keys.push(key)
        keyIndex.set(key, k)
      }
      const valueKey = `${typeof value}:${String(value)}`
      let v = valueIndex.get(valueKey)
      if (v === undefined) {
        v = values.length
        values.push(value)
        valueIndex.set(valueKey, v)
      }
      tags.push(k, v)
    }
    return tags
  }

  const encoded = layer.features.map((feature, index) => ({
    geometry: encodeGeometry(feature.lines, feature.type),
    id: index + 1,
    tags: tagsFor(feature.properties),
    type: feature.type,
  }))

  for (const feature of encoded) {
    pbf.writeMessage(
      2,
      (value, writer) => {
        writer.writeVarintField(1, value.id)
        if (value.tags.length > 0) writer.writePackedVarint(2, value.tags)
        writer.writeVarintField(3, value.type)
        writer.writePackedVarint(4, value.geometry)
      },
      feature,
    )
  }
  for (const key of keys) pbf.writeStringField(3, key)
  for (const value of values) pbf.writeMessage(4, writeValue, value)
}

/** Encode layers into vector tile bytes the real decoder can read. */
export function encodeVectorTile(layers: readonly FixtureLayer[]): Uint8Array {
  const pbf = new PbfWriter()
  for (const layer of layers) pbf.writeMessage(3, writeLayer, layer)
  return pbf.finish()
}
