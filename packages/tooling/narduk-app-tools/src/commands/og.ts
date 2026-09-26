import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { checkSocialPreviews, type SocialPreviewReport } from '../social/check.js'
import { readSocialPreviewConfig } from '../social/config.js'
import { generateSocialImage } from '../social/images.js'

export interface OgArgs {
  root: string
  config: string
  live: boolean
  /** Print the JSON verdict on stdout. Set only when `--json` has no path. */
  json: boolean
  /** Write the JSON verdict here. Same contract as `foundation:check --json <path>`. */
  jsonPath: string | null
  force: boolean
  ifMissing: boolean
  baseUrl?: string
}

export function parseOgArgs(
  args: string[],
  command: 'og:check' | 'og:generate',
  cwd = process.cwd(),
): OgArgs {
  const options: OgArgs = {
    root: existsSync(resolve(cwd, 'apps/web/package.json')) ? resolve(cwd, 'apps/web') : cwd,
    config: 'Config/social-previews.json',
    live: false,
    json: false,
    jsonPath: null,
    force: false,
    ifMissing: false,
  }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--live' && command === 'og:check') options.live = true
    else if (arg === '--json' && command === 'og:check') {
      const next = args[index + 1]
      if (next && !next.startsWith('--')) {
        options.jsonPath = next
        index += 1
      } else options.json = true
    } else if (arg === '--force' && command === 'og:generate') options.force = true
    else if (arg === '--if-missing' && command === 'og:generate') options.ifMissing = true
    else if (
      arg === '--root' ||
      arg === '--config' ||
      (arg === '--base-url' && command === 'og:check')
    ) {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      if (arg === '--root') options.root = resolve(cwd, value)
      else if (arg === '--config') options.config = value
      else options.baseUrl = value
    } else throw new Error(`Unknown ${command} option: ${arg}`)
  }
  if (options.baseUrl && !options.live) throw new Error('--base-url requires --live')
  if (options.force && options.ifMissing) throw new Error('Choose --force or --if-missing')
  return options
}

function ogText(report: SocialPreviewReport, live: boolean): string {
  return [
    `[og] ${report.ok ? 'PASS' : 'FAIL'} ${report.mode}: ${report.pages} classified pages; ${report.samples} crawler samples`,
    ...report.errors.map((error) => `  ${error}`),
    ...(live
      ? []
      : [
          '[og] Live delivery remains unverified; run og:check --live against the deployed origin.',
        ]),
  ].join('\n')
}

/** `--json <path>` writes the verdict and prints the text summary. `--json` alone prints JSON. */
function emitOgReport(options: OgArgs, report: SocialPreviewReport): void {
  if (options.jsonPath) {
    writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  console.log(options.json ? JSON.stringify(report, null, 2) : ogText(report, options.live))
}

export async function runOgCommand(
  command: 'og:check' | 'og:generate',
  args: string[],
): Promise<number> {
  const options = parseOgArgs(args, command)
  if (command === 'og:check' && !existsSync(resolve(options.root, options.config))) {
    const report: SocialPreviewReport = {
      schemaVersion: 1,
      ok: false,
      mode: options.live ? 'live' : 'offline',
      pages: 0,
      samples: 0,
      errors: [`${options.config} is missing`],
    }
    emitOgReport(options, report)
    return 1
  }
  const config = readSocialPreviewConfig(options.root, options.config)
  if (command === 'og:generate') {
    console.log(`[og] ${await generateSocialImage(config, options.root, options)}`)
    return 0
  }
  const report = await checkSocialPreviews(config, options.root, options)
  emitOgReport(options, report)
  return report.ok ? 0 : 1
}
