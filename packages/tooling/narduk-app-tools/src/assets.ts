import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type sharp from 'sharp'

import { encodeIco } from './brand/ico.js'

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
  // A real ICO with 16, 32 and 48 px entries, not a PNG renamed to .ico.
  const icoPath = join(resolved.target, 'favicon.ico')
  const images = await Promise.all(
    [16, 32, 48].map(async (size) => ({
      size,
      png: await sharpFactory(svg).resize(size, size).png().toBuffer(),
    })),
  )
  writeFileSync(icoPath, encodeIco(images))
  outputs.push(icoPath)
  return outputs
}

/**
 * An ICO container of PNG images: ICONDIR (6 bytes), one 16-byte
 * ICONDIRENTRY per image, then the PNG data. Bare PNG bytes under the
 * .ico name are not an icon file, and some clients reject them.
 */
export function packIco(images: ReadonlyArray<{ size: number; png: Buffer }>): Buffer {
  return encodeIco(images)
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
