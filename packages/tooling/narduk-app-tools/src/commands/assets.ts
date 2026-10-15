import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { generateFavicons, parseFaviconArgs } from '../assets.js'
import { checkBrandAssets, checkLiveBrandAssets } from '../brand/check.js'
import type { AssetCheckReport } from '../brand/check.js'
import { SOCIAL_PREVIEW_CONFIG_PATH, generateBrandAssets } from '../brand/generate.js'

export const ASSETS_USAGE = [
  'Usage:',
  '  narduk-app assets generate [--root <app>] [--force] [--if-missing] [--no-og]',
  '  narduk-app assets check [--root <app>] [--json [path]]',
  '  narduk-app assets check --live [<url>] [--json [path]]   (default: the siteUrl)',
  '  narduk-app assets favicons [--source <svg>] [--target <dir>]',
].join('\n')

export interface AssetsArgs {
  root: string
  force: boolean
  og: boolean
  live: string | null
  json: boolean
  jsonPath: string | null
}

export function parseAssetsArgs(
  args: string[],
  command: 'generate' | 'check',
  cwd = process.cwd(),
): AssetsArgs {
  const options: AssetsArgs = {
    root: existsSync(resolve(cwd, 'apps/web/package.json')) ? resolve(cwd, 'apps/web') : cwd,
    force: false,
    og: true,
    live: null,
    json: false,
    jsonPath: null,
  }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--root') {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error('--root requires a value')
      options.root = resolve(cwd, value)
    } else if (command === 'generate' && arg === '--force') options.force = true
    // The default already keeps existing files; the flag documents that in build scripts.
    else if (command === 'generate' && arg === '--if-missing') options.force = false
    else if (command === 'generate' && arg === '--no-og') options.og = false
    else if (command === 'check' && arg === '--live') {
      // Bare `--live` checks the app's own siteUrl.
      const next = args[index + 1]
      if (next && !next.startsWith('--')) {
        options.live = next
        index += 1
      } else options.live = ''
    } else if (command === 'check' && arg === '--json') {
      const next = args[index + 1]
      if (next && !next.startsWith('--')) {
        options.jsonPath = next
        index += 1
      } else options.json = true
    } else throw new Error(`Unknown assets ${command} option: ${arg}\n${ASSETS_USAGE}`)
  }
  if (command === 'generate' && args.includes('--force') && args.includes('--if-missing'))
    throw new Error('Choose --force or --if-missing')
  return options
}

function liveSiteUrl(root: string): string {
  const social = resolve(root, SOCIAL_PREVIEW_CONFIG_PATH)
  if (existsSync(social)) {
    const siteUrl = (JSON.parse(readFileSync(social, 'utf8')) as { siteUrl?: unknown }).siteUrl
    if (typeof siteUrl === 'string' && siteUrl) return siteUrl
  }
  const manifest = resolve(root, 'package.json')
  if (existsSync(manifest)) {
    const homepage = (JSON.parse(readFileSync(manifest, 'utf8')) as { homepage?: unknown }).homepage
    if (typeof homepage === 'string' && homepage) return homepage
  }
  throw new Error(`--live needs a URL: ${SOCIAL_PREVIEW_CONFIG_PATH} has no siteUrl`)
}

export function formatAssetReport(report: AssetCheckReport): string {
  return [
    `[assets] ${report.ok ? 'PASS' : 'FAIL'} ${report.mode}: ${report.checked.length} files checked at ${report.target}`,
    ...report.errors.map((error) => `  ${error}`),
  ].join('\n')
}

export async function runAssetsCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args
  if (subcommand === 'favicons') {
    const outputs = await generateFavicons(parseFaviconArgs(rest))
    console.log(`[assets] wrote ${outputs.length} favicon assets`)
    return 0
  }
  if (subcommand === 'generate') {
    const options = parseAssetsArgs(rest, 'generate')
    const result = await generateBrandAssets({
      root: options.root,
      force: options.force,
      skipOg: !options.og,
    })
    const name = (path: string) => relative(options.root, path)
    for (const path of result.written) console.log(`[assets] wrote ${name(path)}`)
    if (result.kept.length)
      console.log(
        `[assets] kept ${result.kept.length} existing files (--force replaces them): ${result.kept.map(name).join(', ')}`,
      )
    if (result.og) console.log(`[assets] share card ${name(result.og.path)}: ${result.og.action}`)
    const font = result.font
    if (font?.action === 'failed')
      console.warn(
        `[assets] WARN display font not resolved, the card uses the bundled face: ${font.error}`,
      )
    else if (font)
      console.log(
        `[assets] display font ${name(font.path)} (${font.info?.family} ${font.info?.weight}): ${font.action}`,
      )
    for (const warning of font?.warnings ?? []) console.warn(`[assets] WARN ${warning}`)
    return 0
  }
  if (subcommand === 'check') {
    const options = parseAssetsArgs(rest, 'check')
    const report =
      options.live === null
        ? await checkBrandAssets(options.root)
        : await checkLiveBrandAssets(options.live || liveSiteUrl(options.root))
    if (options.jsonPath) writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(options.json ? JSON.stringify(report, null, 2) : formatAssetReport(report))
    return report.ok ? 0 : 1
  }
  throw new Error(ASSETS_USAGE)
}
