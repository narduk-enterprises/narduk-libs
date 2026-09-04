import { inflateSync } from 'node:zlib'

/**
 * A minimal, test-local PNG decoder for the `render-parity-v1` golden tiles.
 *
 * This package ships with **zero runtime dependencies** and that stays true
 * here: rather than reach for a PNG library, this decodes exactly what the
 * vendored fixtures actually are — verified once, directly, by walking their
 * chunks — and throws loudly on anything else, so a future fixture in a shape
 * this does not handle fails with a clear message instead of silently
 * misreading pixels.
 *
 * What the ten `expected/**\/*.png` files in `tests/fixtures/render-parity-v1/`
 * actually are, confirmed by inspection: 256×256, 8-bit depth, **color type 3
 * (palette)**, non-interlaced, every scanline filtered with type 0 (`None`).
 * Only that shape is exercised by the fixtures, but this decoder also
 * implements color types 2 (RGB) and 6 (RGBA) — both plausible PNG encodings
 * for the same pixels — and all five PNG filter types, so a regenerated pack
 * that happens to encode differently (a different Pillow version, a different
 * `optimize` setting) does not silently break the harness over a cosmetic
 * re-encoding of identical pixels. Anything outside that (16-bit depth,
 * interlacing, grayscale, an unknown filter byte) throws.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface DecodedPng {
  width: number
  height: number
  /** Straight (non-premultiplied) RGBA8, row-major, top row first. */
  pixels: Uint8ClampedArray
}

interface Ihdr {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlace: number
}

/** Bytes per pixel for the color types this decoder supports, at 8-bit depth. */
function bytesPerPixel(colorType: number): number {
  switch (colorType) {
    case 2:
      return 3 // RGB
    case 3:
      return 1 // palette index
    case 6:
      return 4 // RGBA
    default:
      throw new Error(`png: unsupported color type ${colorType} (supports 2, 3, 6)`)
  }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * Undo PNG's per-scanline filtering, in place conceptually: returns one
 * `Buffer` of reconstructed (unfiltered) scanlines, `rowBytes` each.
 *
 * All five filter types (0 `None`, 1 `Sub`, 2 `Up`, 3 `Average`, 4 `Paeth`) are
 * implemented per the PNG spec, even though every scanline in the vendored
 * fixtures happens to use type 0 — a decoder that only handled the observed
 * type would be one Pillow version away from breaking silently.
 */
function unfilter(inflated: Buffer, width: number, height: number, bpp: number): Buffer {
  const rowBytes = width * bpp
  const stride = 1 + rowBytes
  if (inflated.byteLength !== stride * height) {
    throw new Error(
      `png: inflated data is ${inflated.byteLength} bytes, expected ${stride * height} ` +
        `for ${width}x${height} at ${bpp} bytes/pixel`,
    )
  }

  const out = Buffer.alloc(rowBytes * height)
  let prevRowStart = -1
  for (let row = 0; row < height; row += 1) {
    const srcStart = row * stride
    const filterType = inflated[srcStart]!
    const rowStart = row * rowBytes
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[srcStart + 1 + x]!
      const a = x >= bpp ? out[rowStart + x - bpp]! : 0
      const b = prevRowStart >= 0 ? out[prevRowStart + x]! : 0
      const c = prevRowStart >= 0 && x >= bpp ? out[prevRowStart + x - bpp]! : 0

      let value: number
      switch (filterType) {
        case 0:
          value = raw
          break
        case 1:
          value = raw + a
          break
        case 2:
          value = raw + b
          break
        case 3:
          value = raw + Math.floor((a + b) / 2)
          break
        case 4:
          value = raw + paethPredictor(a, b, c)
          break
        default:
          throw new Error(`png: unknown scanline filter type ${filterType} at row ${row}`)
      }
      out[rowStart + x] = value & 0xff
    }
    prevRowStart = rowStart
  }
  return out
}

/** Decode an 8-bit, non-interlaced PNG (color type 2, 3, or 6) into straight RGBA8. */
export function decodePng(buffer: Uint8Array): DecodedPng {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  if (data.byteLength < 8 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('png: missing PNG signature')
  }

  let ihdr: Ihdr | null = null
  let palette: Buffer | null = null
  let transparency: Buffer | null = null
  const idatChunks: Buffer[] = []

  let offset = 8
  while (offset < data.byteLength) {
    if (offset + 8 > data.byteLength) throw new Error('png: truncated chunk header')
    const length = data.readUInt32BE(offset)
    const type = data.toString('ascii', offset + 4, offset + 8)
    const bodyStart = offset + 8
    const bodyEnd = bodyStart + length
    if (bodyEnd + 4 > data.byteLength) throw new Error(`png: truncated ${type} chunk`)
    const body = data.subarray(bodyStart, bodyEnd)

    switch (type) {
      case 'IHDR': {
        if (length !== 13) throw new Error('png: malformed IHDR')
        const width = body.readUInt32BE(0)
        const height = body.readUInt32BE(4)
        const bitDepth = body.readUInt8(8)
        const colorType = body.readUInt8(9)
        const interlace = body.readUInt8(12)
        if (bitDepth !== 8) {
          throw new Error(`png: unsupported bit depth ${bitDepth} (only 8-bit fixtures expected)`)
        }
        if (interlace !== 0) {
          throw new Error('png: interlaced PNG not supported (fixtures are non-interlaced)')
        }
        ihdr = { width, height, bitDepth, colorType, interlace }
        break
      }
      case 'PLTE':
        palette = Buffer.from(body)
        break
      case 'tRNS':
        transparency = Buffer.from(body)
        break
      case 'IDAT':
        idatChunks.push(Buffer.from(body))
        break
      case 'IEND':
        offset = data.byteLength
        continue
      default:
        // Ancillary chunks (gAMA, pHYs, tEXt, ...) carry nothing this harness
        // needs; skip rather than throw, matching the PNG spec's own
        // "unrecognized ancillary chunks may be ignored" rule.
        break
    }
    offset = bodyEnd + 4 // + CRC
  }

  if (!ihdr) throw new Error('png: missing IHDR chunk')
  if (idatChunks.length === 0) throw new Error('png: missing IDAT data')

  const { width, height, colorType } = ihdr
  const bpp = bytesPerPixel(colorType)
  if (colorType === 3 && !palette) throw new Error('png: color type 3 requires a PLTE chunk')

  const inflated = inflateSync(Buffer.concat(idatChunks))
  const reconstructed = unfilter(inflated, width, height, bpp)

  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    const srcOffset = i * bpp
    const dstOffset = i * 4
    if (colorType === 6) {
      pixels[dstOffset] = reconstructed[srcOffset]!
      pixels[dstOffset + 1] = reconstructed[srcOffset + 1]!
      pixels[dstOffset + 2] = reconstructed[srcOffset + 2]!
      pixels[dstOffset + 3] = reconstructed[srcOffset + 3]!
    } else if (colorType === 2) {
      pixels[dstOffset] = reconstructed[srcOffset]!
      pixels[dstOffset + 1] = reconstructed[srcOffset + 1]!
      pixels[dstOffset + 2] = reconstructed[srcOffset + 2]!
      pixels[dstOffset + 3] = 255
    } else {
      const index = reconstructed[srcOffset]!
      const paletteOffset = index * 3
      if (paletteOffset + 2 >= palette!.byteLength) {
        throw new Error(`png: palette index ${index} out of range`)
      }
      pixels[dstOffset] = palette![paletteOffset]!
      pixels[dstOffset + 1] = palette![paletteOffset + 1]!
      pixels[dstOffset + 2] = palette![paletteOffset + 2]!
      pixels[dstOffset + 3] =
        transparency && index < transparency.byteLength ? transparency[index]! : 255
    }
  }

  return { width, height, pixels }
}
