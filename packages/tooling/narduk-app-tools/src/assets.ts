import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type sharp from 'sharp'

export interface FaviconOptions {
  source?: string
  target?: string
}

export function resolveFaviconOptions(
  options: FaviconOptions = {},
  cwd = process.cwd(),
): Required<FaviconOptions> {
  const target = resolve(
    cwd,
    options.target ??
      (existsSync(join(cwd, 'apps', 'web', 'public')) ? 'apps/web/public' : 'public'),
  )
  return {
    source: resolve(cwd, options.source ?? join(target, 'favicon.svg')),
    target,
  }
}

export async function generateFavicons(
  options: FaviconOptions = {},
  cwd = process.cwd(),
): Promise<string[]> {
  const resolved = resolveFaviconOptions(options, cwd)
  if (!existsSync(resolved.source)) throw new Error(`Source SVG not found: ${resolved.source}`)
  mkdirSync(resolved.target, { recursive: true })
  let sharpFactory: typeof sharp
  try {
    sharpFactory = (await import('sharp')).default
  } catch {
    throw new Error('The favicon command requires the sharp package to be installed.')
  }
  const svg = readFileSync(resolved.source)
  const outputs: string[] = []
  const writePng = async (filename: string, size: number): Promise<void> => {
    const path = join(resolved.target, filename)
    await sharpFactory(svg).resize(size, size).png().toFile(path)
    outputs.push(path)
  }
  await writePng('apple-touch-icon.png', 180)
  await writePng('favicon-32x32.png', 32)
  await writePng('favicon-16x16.png', 16)
  const icoPath = join(resolved.target, 'favicon.ico')
  const icoSizes = [16, 32, 48]
  const icoImages = await Promise.all(
    icoSizes.map((size) => sharpFactory(svg).resize(size, size).png().toBuffer()),
  )
  writeFileSync(icoPath, packIco(icoSizes.map((size, index) => ({ size, png: icoImages[index]! }))))
  outputs.push(icoPath)
  return outputs
}

/**
 * An ICO container of PNG images: ICONDIR (6 bytes), one 16-byte
 * ICONDIRENTRY per image, then the PNG data. Bare PNG bytes under the
 * .ico name are not an icon file, and some clients reject them.
 */
export function packIco(images: ReadonlyArray<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  for (const [index, { size, png }] of images.entries()) {
    const entry = 6 + index * 16
    // A width or height of 256 is stored as 0.
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt8(0, entry + 2)
    header.writeUInt8(0, entry + 3)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  }
  return Buffer.concat([header, ...images.map(({ png }) => png)])
}

export function parseFaviconArgs(args: string[]): FaviconOptions {
  const options: FaviconOptions = {}
  const values = new Map([
    ['--source', 'source'],
    ['--target', 'target'],
  ])
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const key = values.get(arg)
    if (!key) throw new Error(`Unknown favicons option: ${arg}`)
    const value = args[++index]
    if (!value) throw new Error(`${arg} requires a value`)
    ;(options as Record<string, unknown>)[key] = value
  }
  return options
}
