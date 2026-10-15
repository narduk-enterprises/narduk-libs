/**
 * A real multi-size ICO: one PNG-compressed entry per size (Windows Vista and
 * every current browser read PNG entries). A PNG renamed to `.ico`, or a text
 * data URL, is not one -- which is what the estate's placeholders were.
 */

const HEADER_BYTES = 6
const ENTRY_BYTES = 16
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface IcoImage {
  size: number
  png: Uint8Array
}

export interface IcoEntry {
  width: number
  height: number
  png: boolean
  bytes: Uint8Array
}

export function encodeIco(images: readonly IcoImage[]): Buffer {
  if (images.length === 0) throw new Error('An ICO needs at least one image')
  const header = Buffer.alloc(HEADER_BYTES)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = Buffer.alloc(ENTRY_BYTES * images.length)
  let offset = HEADER_BYTES + entries.length
  for (const [index, image] of images.entries()) {
    if (image.size < 1 || image.size > 256)
      throw new Error(`ICO sizes are 1-256, got ${image.size}`)
    const at = index * ENTRY_BYTES
    entries.writeUInt8(image.size === 256 ? 0 : image.size, at)
    entries.writeUInt8(image.size === 256 ? 0 : image.size, at + 1)
    entries.writeUInt8(0, at + 2)
    entries.writeUInt8(0, at + 3)
    entries.writeUInt16LE(1, at + 4)
    entries.writeUInt16LE(32, at + 6)
    entries.writeUInt32LE(image.png.byteLength, at + 8)
    entries.writeUInt32LE(offset, at + 12)
    offset += image.png.byteLength
  }
  return Buffer.concat([header, entries, ...images.map((image) => Buffer.from(image.png))])
}

/** Parses the directory and slices each entry; throws on anything that is not an ICO. */
export function decodeIco(bytes: Uint8Array): IcoEntry[] {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buffer.byteLength < HEADER_BYTES) throw new Error('too short to be an ICO')
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1)
    throw new Error('not an ICO (bad header)')
  const count = buffer.readUInt16LE(4)
  if (count === 0) throw new Error('ICO has no images')
  if (buffer.byteLength < HEADER_BYTES + count * ENTRY_BYTES)
    throw new Error('ICO directory is truncated')
  const entries: IcoEntry[] = []
  for (let index = 0; index < count; index++) {
    const at = HEADER_BYTES + index * ENTRY_BYTES
    const width = buffer.readUInt8(at) || 256
    const height = buffer.readUInt8(at + 1) || 256
    const size = buffer.readUInt32LE(at + 8)
    const offset = buffer.readUInt32LE(at + 12)
    if (size === 0 || offset + size > buffer.byteLength)
      throw new Error(`ICO entry ${index + 1} points outside the file`)
    const slice = buffer.subarray(offset, offset + size)
    entries.push({
      width,
      height,
      png: slice.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
      bytes: slice,
    })
  }
  return entries
}
