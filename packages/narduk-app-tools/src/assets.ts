import { existsSync, mkdirSync, readFileSync } from 'node:fs'
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
  await writePng('favicon.ico', 32)
  return outputs
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
