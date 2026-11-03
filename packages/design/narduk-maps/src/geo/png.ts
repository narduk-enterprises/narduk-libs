// A small exact PNG decoder for data tiles. Browsers decode images through colour management and
// premultiplied alpha, which corrupts terrarium bytes; this reads the file itself, so the bytes the
// GPU colours and the readout reports are exactly the bytes the producer wrote.
// Supports 8-bit RGBA (6) and RGB (2), and palette (3) at 1/2/4/8 bits; not interlaced.

export interface DecodedImage {
  /** RGBA8, row-major, `width * height * 4` bytes. */
  data: Uint8Array
  height: number
  width: number
}

export interface PngParts {
  bitDepth: number
  colorType: number
  height: number
  idat: Uint8Array
  interlace: number
  palette?: Uint8Array
  transparency?: Uint8Array
  width: number
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

export function isPng(bytes: Uint8Array): boolean {
  return SIGNATURE.every((b, i) => bytes[i] === b)
}

/** Split a PNG into its header fields and concatenated IDAT payload. */
export function parsePng(bytes: Uint8Array): PngParts {
  if (!isPng(bytes)) throw new Error('not a PNG')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let off = 8
  let header: Omit<PngParts, 'idat' | 'palette' | 'transparency'> | undefined
  let palette: Uint8Array | undefined
  let transparency: Uint8Array | undefined
  const idat: Uint8Array[] = []
  while (off + 8 <= bytes.length) {
    const len = view.getUint32(off)
    const type = String.fromCharCode(
      bytes[off + 4]!,
      bytes[off + 5]!,
      bytes[off + 6]!,
      bytes[off + 7]!,
    )
    const body = bytes.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      header = {
        width: view.getUint32(off + 8),
        height: view.getUint32(off + 12),
        bitDepth: body[8]!,
        colorType: body[9]!,
        interlace: body[12]!,
      }
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') transparency = body
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (!header) throw new Error('PNG has no IHDR')
  const total = idat.reduce((n, c) => n + c.length, 0)
  const joined = new Uint8Array(total)
  let at = 0
  for (const c of idat) {
    joined.set(c, at)
    at += c.length
  }
  return { ...header, idat: joined, palette, transparency }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

function predict(filter: number, a: number, b: number, c: number): number {
  if (filter === 0) return 0
  if (filter === 1) return a
  if (filter === 2) return b
  if (filter === 3) return (a + b) >> 1
  if (filter === 4) return paeth(a, b, c)
  throw new Error(`PNG filter ${filter}`)
}

/** Undo the five PNG scanline filters. `raw` is the inflated IDAT stream. */
export function unfilter(
  raw: Uint8Array,
  rowBytes: number,
  height: number,
  bpp: number,
): Uint8Array {
  const out = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)]!
    const src = y * (rowBytes + 1) + 1
    const dst = y * rowBytes
    const prev = dst - rowBytes
    for (let i = 0; i < rowBytes; i++) {
      const x = raw[src + i]!
      const a = i >= bpp ? out[dst + i - bpp]! : 0
      const b = y > 0 ? out[prev + i]! : 0
      const c = y > 0 && i >= bpp ? out[prev + i - bpp]! : 0
      out[dst + i] = (x + predict(filter, a, b, c)) & 255
    }
  }
  return out
}

/** Turn unfiltered scanlines of any supported colour type into RGBA8. */
export function toRgba(parts: PngParts, pixels: Uint8Array): Uint8Array {
  const { width, height, colorType, bitDepth } = parts
  const out = new Uint8Array(width * height * 4)
  if (colorType === 6 && bitDepth === 8) {
    out.set(pixels.subarray(0, out.length))
    return out
  }
  if (colorType === 2 && bitDepth === 8) {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      out[i * 4] = pixels[j]!
      out[i * 4 + 1] = pixels[j + 1]!
      out[i * 4 + 2] = pixels[j + 2]!
      out[i * 4 + 3] = 255
    }
    return out
  }
  if (colorType === 3 && [1, 2, 4, 8].includes(bitDepth) && parts.palette) {
    const rowBytes = Math.ceil((width * bitDepth) / 8)
    const mask = (1 << bitDepth) - 1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = x * bitDepth
        const byte = pixels[y * rowBytes + (bit >> 3)]!
        const index = (byte >> (8 - bitDepth - (bit & 7))) & mask
        const o = (y * width + x) * 4
        out[o] = parts.palette[index * 3] ?? 0
        out[o + 1] = parts.palette[index * 3 + 1] ?? 0
        out[o + 2] = parts.palette[index * 3 + 2] ?? 0
        out[o + 3] = parts.transparency?.[index] ?? 255
      }
    }
    return out
  }
  throw new Error(`PNG colour type ${colorType} at ${bitDepth} bits is not supported`)
}

function bytesPerPixel(parts: PngParts): { bpp: number; rowBytes: number } {
  const channels = parts.colorType === 6 ? 4 : parts.colorType === 2 ? 3 : 1
  const bits = channels * parts.bitDepth
  return { bpp: Math.max(1, bits >> 3), rowBytes: Math.ceil((parts.width * bits) / 8) }
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Decode the PNG's exact bytes to RGBA8. */
export async function decodePng(buffer: ArrayBuffer | Uint8Array): Promise<DecodedImage> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const parts = parsePng(bytes)
  if (parts.interlace !== 0) throw new Error('interlaced PNG is not supported')
  const { bpp, rowBytes } = bytesPerPixel(parts)
  const raw = await inflate(parts.idat)
  const pixels = unfilter(raw, rowBytes, parts.height, bpp)
  return { width: parts.width, height: parts.height, data: toRgba(parts, pixels) }
}

/**
 * Decode any tile image. PNGs take the exact path; anything else (WebP photographs) goes through
 * the browser, which is fine for colour pictures and never used for numeric fields.
 */
export async function decodeImage(buffer: ArrayBuffer): Promise<DecodedImage> {
  const bytes = new Uint8Array(buffer)
  if (isPng(bytes)) return decodePng(bytes)
  const bitmap = await createImageBitmap(new Blob([bytes]), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(bitmap, 0, 0)
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  bitmap.close()
  return { width: img.width, height: img.height, data: new Uint8Array(img.data.buffer) }
}
