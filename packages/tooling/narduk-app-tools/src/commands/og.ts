import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { checkSocialPreviews } from '../social/check.js'
import { readSocialPreviewConfig } from '../social/config.js'
import { generateSocialImage } from '../social/images.js'

export interface OgArgs {
  root: string
  config: string
  live: boolean
  json: boolean
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
    force: false,
    ifMissing: false,
  }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--live' && command === 'og:check') options.live = true
    else if (arg === '--json' && command === 'og:check') options.json = true
    else if (arg === '--force' && command === 'og:generate') options.force = true
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

export async function runOgCommand(
  command: 'og:check' | 'og:generate',
  args: string[],
): Promise<number> {
  const options = parseOgArgs(args, command)
  const config = readSocialPreviewConfig(options.root, options.config)
  if (command === 'og:generate') {
    console.log(`[og] ${await generateSocialImage(config, options.root, options)}`)
    return 0
  }
  const report = await checkSocialPreviews(config, options.root, options)
  console.log(
    options.json
      ? JSON.stringify(report, null, 2)
      : [
          `[og] ${report.ok ? 'PASS' : 'FAIL'} ${report.mode}: ${report.pages} classified pages; ${report.samples} crawler samples`,
          ...report.errors.map((error) => `  ${error}`),
          ...(options.live
            ? []
            : [
                '[og] Live delivery remains unverified; run og:check --live against the deployed origin.',
              ]),
        ].join('\n'),
  )
  return report.ok ? 0 : 1
}
