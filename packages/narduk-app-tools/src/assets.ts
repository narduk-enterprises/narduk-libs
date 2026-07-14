import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type sharp from 'sharp'

export interface FaviconOptions {
  backgroundColor?: string
  color?: string
  description?: string
  name?: string
  scope?: string
  shortName?: string
  source?: string
  startUrl?: string
  target?: string
}

function readPackageMetadata(cwd: string): { description?: string; name?: string } {
  const path = join(cwd, 'package.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as { description?: string; name?: string }
  } catch {
    return {}
  }
}

export function resolveFaviconOptions(
  options: FaviconOptions = {},
  cwd = process.cwd(),
): Required<FaviconOptions> {
  const metadata = readPackageMetadata(cwd)
  const target = resolve(
    cwd,
    options.target ??
      (existsSync(join(cwd, 'apps', 'web', 'public')) ? 'apps/web/public' : 'public'),
  )
  const name = options.name ?? metadata.name ?? 'Narduk App'
  return {
    backgroundColor: options.backgroundColor ?? '#0B1120',
    color: options.color ?? '#10b981',
    description: options.description ?? metadata.description ?? `${name} web application.`,
    name,
    scope: options.scope ?? '/',
    shortName: (options.shortName ?? name).slice(0, 12),
    source: resolve(cwd, options.source ?? join(target, 'favicon.svg')),
    startUrl: options.startUrl ?? '/',
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
  for (const size of [192, 512] as const) {
    const foreground = Math.round(size * 0.78)
    const inset = Math.floor((size - foreground) / 2)
    await sharpFactory(svg)
      .resize(foreground, foreground, { fit: 'contain' })
      .extend({
        background: resolved.backgroundColor,
        bottom: size - foreground - inset,
        left: inset,
        right: inset,
        top: inset,
      })
      .png()
      .toFile(join(resolved.target, `pwa-${size}x${size}.png`))
    outputs.push(join(resolved.target, `pwa-${size}x${size}.png`))
  }
  await writePng('favicon.ico', 32)
  const manifestPath = join(resolved.target, 'site.webmanifest')
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        background_color: resolved.backgroundColor,
        display: 'standalone',
        icons: [
          { src: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
          { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
          { purpose: 'any maskable', src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { purpose: 'any maskable', src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
        name: resolved.name,
        scope: resolved.scope,
        short_name: resolved.shortName,
        start_url: resolved.startUrl,
        theme_color: resolved.color,
        description: resolved.description,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  outputs.push(manifestPath)
  return outputs
}

export function parseFaviconArgs(args: string[]): FaviconOptions {
  const options: FaviconOptions = {}
  const values = new Map([
    ['--bg', 'backgroundColor'],
    ['--color', 'color'],
    ['--description', 'description'],
    ['--name', 'name'],
    ['--scope', 'scope'],
    ['--short-name', 'shortName'],
    ['--source', 'source'],
    ['--start-url', 'startUrl'],
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
