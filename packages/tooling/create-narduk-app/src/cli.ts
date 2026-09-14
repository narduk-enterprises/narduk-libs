#!/usr/bin/env node

import { cwd, stderr as processStderr, stdout as processStdout } from 'node:process'
import { resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createNardukApp } from './generate.js'
import { CreateNardukAppError } from './types.js'
import type { CreateNardukAppCliOptions, CreateNardukAppOptions, ProductSpec } from './types.js'

function usage(): string {
  return (
    [
      'Usage: create-narduk-app <app-name> [options]',
      '',
      'Options:',
      '  --capabilities <list>       Comma-separated: auth, seo, analytics, uploads, ai, mapkit',
      '  --capability <name>        Add one capability; may be repeated',
      '  --display-name <name>       Human-readable app name',
      '  --description <text>        Product description',
      '  --site-url <url>            Public or local site URL',
      '  --target-dir <path>         Output directory (defaults to ./<app-name>)',
      '  --visibility <value>        Repository: private (default) or public',
      '  --exposure <value>          App: public or authenticated (auth capability defaults closed)',
      '  --local-dev-port <port>     Local Nuxt port (default: 3000)',
      '  --problem <text>            Product spec problem',
      '  --audience <text>           Product spec audience',
      '  --value-proposition <text>  Product spec value proposition',
      '  --primary-action <text>     Product spec primary action',
      '  --success-metrics <text>    Product spec success metrics',
      '  --constraints <text>        Product spec constraints',
      '  --no-git                    Do not initialize a local git repository',
      '  --force                     Permit writing into a non-empty directory',
      '  --json                      Print only the machine-readable report',
      '  --help                      Show this help',
    ].join('\n') + '\n'
  )
}

function nextValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('-')) throw new CreateNardukAppError(flag + ' requires a value.')
  return value
}

function readOptionValue(
  argument: string,
  argv: readonly string[],
  index: number,
): { value: string; consumed: number } {
  const equalsIndex = argument.indexOf('=')
  if (equalsIndex !== -1) return { value: argument.slice(equalsIndex + 1), consumed: 0 }
  return { value: nextValue(argv, index, argument), consumed: 1 }
}

export function parseCliArguments(
  argv: readonly string[],
  currentCwd = cwd(),
): { json: boolean; options: CreateNardukAppOptions } {
  const positional: string[] = []
  const productSpec: ProductSpec = {}
  const capabilityValues: string[] = []
  let namedApp: string | undefined
  let displayName: string | undefined
  let description: string | undefined
  let siteUrl: string | undefined
  let targetDir: string | undefined
  let visibility: 'private' | 'public' | undefined
  let exposure: 'public' | 'authenticated' | undefined
  let localPort: number | undefined
  let noGit = false
  let force = false
  let jsonOutput = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument) continue
    if (argument === '--help' || argument === '-h') throw new CreateNardukAppError(usage())
    if (!argument.startsWith('-')) {
      positional.push(argument)
      continue
    }
    if (argument === '--no-git') {
      noGit = true
      continue
    }
    if (argument === '--force') {
      force = true
      continue
    }
    if (argument === '--json') {
      jsonOutput = true
      continue
    }

    const [flag] = argument.split('=', 1)
    const parsed = readOptionValue(argument, argv, index)
    index += parsed.consumed
    switch (flag) {
      case '--name':
      case '--app-name':
        namedApp = parsed.value
        break
      case '--capabilities':
        capabilityValues.push(parsed.value)
        break
      case '--capability':
        capabilityValues.push(parsed.value)
        break
      case '--display-name':
        displayName = parsed.value
        break
      case '--description':
        description = parsed.value
        break
      case '--site-url':
        siteUrl = parsed.value
        break
      case '--target-dir':
        targetDir = parsed.value
        break
      case '--visibility':
        if (parsed.value !== 'private' && parsed.value !== 'public') {
          throw new CreateNardukAppError('--visibility must be private or public.')
        }
        visibility = parsed.value
        break
      case '--exposure':
        if (parsed.value !== 'public' && parsed.value !== 'authenticated') {
          throw new CreateNardukAppError('--exposure must be public or authenticated.')
        }
        exposure = parsed.value
        break
      case '--local-dev-port':
      case '--local-port': {
        const parsedPort = Number(parsed.value)
        if (!Number.isInteger(parsedPort)) {
          throw new CreateNardukAppError('--local-dev-port must be an integer.')
        }
        localPort = parsedPort
        break
      }
      case '--problem':
        productSpec.problem = parsed.value
        break
      case '--audience':
        productSpec.audience = parsed.value
        break
      case '--value-proposition':
        productSpec.valueProposition = parsed.value
        break
      case '--primary-action':
        productSpec.primaryAction = parsed.value
        break
      case '--success-metrics':
        productSpec.successMetrics = parsed.value
        break
      case '--constraints':
        productSpec.constraints = parsed.value
        break
      default:
        throw new CreateNardukAppError('Unknown option "' + flag + '".')
    }
  }

  const appName = positional[0] ?? namedApp
  if (!appName) throw new CreateNardukAppError(usage())
  if (positional.length > 1) {
    throw new CreateNardukAppError('Only one app name may be provided.')
  }

  return {
    json: jsonOutput,
    options: {
      appName,
      capabilities: capabilityValues.join(','),
      description,
      displayName,
      exposure,
      force,
      localPort,
      noGit,
      productSpec,
      siteUrl,
      targetDir: resolve(currentCwd, targetDir ?? appName),
      visibility,
    },
  }
}

export async function runCli(options: CreateNardukAppCliOptions = {}): Promise<number> {
  const output = options.stdout ?? processStdout
  const errorOutput = options.stderr ?? processStderr
  const argv = options.argv ?? process.argv.slice(2)

  if (argv.includes('--help') || argv.includes('-h')) {
    output.write(usage())
    return 0
  }

  try {
    const parsed = parseCliArguments(argv, options.cwd ?? cwd())
    const report = await createNardukApp(parsed.options)
    output.write(
      parsed.json
        ? JSON.stringify(report, null, 2) + '\n'
        : 'Created ' + report.appName + ' in ' + report.targetDir + '\n',
    )
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errorOutput.write(message + '\n')
    return 1
  }
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false

  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entrypoint)
  } catch {
    // An imported module can have no filesystem entrypoint (for example node -e).
    return false
  }
}

if (isMainModule()) {
  const exitCode = await runCli()
  process.exitCode = exitCode
}
