/**
 * The journeys CLI: the consumers that need real logic beyond the engines.
 * Test and capture execution go through Playwright Test with the ./web
 * adapter; this binary owns rehearse, verify, promote and walkthrough.
 */
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { defineCatalog } from '../define.js'
import { digestDirectory } from '../digest.js'
import { buildRehearsal } from '../rehearse.js'
import type { Catalog, Surface } from '../types.js'
import { promoteRun, readRunManifest, verifyRun } from '../verify.js'
import { buildWalkthrough } from '../walkthrough.js'

interface Flags {
  positional: string[]
  named: Map<string, string>
  bare: Set<string>
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { positional: [], named: new Map(), bare: new Set() }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string
    if (!argument.startsWith('--')) {
      flags.positional.push(argument)
      continue
    }
    const name = argument.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags.named.set(name, next)
      index += 1
    } else {
      flags.bare.add(name)
    }
  }
  return flags
}

async function loadCatalog(flags: Flags): Promise<{ catalog: Catalog; catalogDir: string }> {
  const modulePath = flags.named.get('catalog')
  if (!modulePath) throw new Error('--catalog <module.mjs exporting `catalog`> is required')
  const resolved = resolve(modulePath)
  const imported = (await import(pathToFileURL(resolved).href)) as { catalog?: Catalog }
  if (!imported.catalog) throw new Error(`${modulePath} does not export \`catalog\``)
  const catalogDir = resolve(flags.named.get('catalog-dir') ?? resolve(resolved, '..'))
  return { catalog: defineCatalog(imported.catalog), catalogDir }
}

const USAGE = `journeys <command>

  rehearse    --catalog <module>                      print the watermarked rehearsal script
  verify      --catalog <module> --run <dir>          verify one run attempt against the declaration
  promote     --catalog <module> --run <dir> --run-id <id> --latest <path>
  walkthrough --catalog <module> --out-root <dir> --env <name> --profile <name> --dest <dir>
              [--profile-<surface> <name>] [--env-<surface> <name>]
              [--allow-mixed-app-revision]

  --catalog-dir <dir>   directory whose files form the declaration digest
                        (default: the catalog module's directory)
  --profile-<surface>   the capture profile that surface's promoted runs live
                        under, when it is not --profile
  --env-<surface>       the environment that surface's runs live under, when it
                        is not --env. A web journey runs against a deployment
                        and a handset journey against an in-app fixture world,
                        so one story's two halves file under two names — these
                        are what let the walkthrough assemble them onto one page.
`

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  const flags = parseArgs(rest)
  try {
    switch (command) {
      case 'rehearse': {
        const { catalog } = await loadCatalog(flags)
        process.stdout.write(`${buildRehearsal(catalog)}\n`)
        return 0
      }
      case 'verify': {
        const { catalog, catalogDir } = await loadCatalog(flags)
        const runDirectory = flags.named.get('run')
        if (!runDirectory) throw new Error('--run <attempt directory> is required')
        const manifest = readRunManifest(runDirectory)
        const issues = verifyRun(catalog, manifest, runDirectory, {
          currentDigest: digestDirectory(catalogDir),
        })
        if (issues.length > 0) {
          process.stderr.write(`run fails verification:\n- ${issues.join('\n- ')}\n`)
          return 1
        }
        process.stdout.write(`run verifies against the declaration (${manifest.journey})\n`)
        return 0
      }
      case 'promote': {
        const { catalog, catalogDir } = await loadCatalog(flags)
        const runDirectory = flags.named.get('run')
        const latestPath = flags.named.get('latest')
        if (!runDirectory || !latestPath) {
          throw new Error('--run <attempt directory> and --latest <path> are required')
        }
        const manifest = readRunManifest(runDirectory)
        promoteRun(catalog, manifest, runDirectory, {
          currentDigest: digestDirectory(catalogDir),
          runId: flags.named.get('run-id') ?? basename(runDirectory),
          latestPath,
        })
        process.stdout.write(`promoted ${manifest.journey} (${basename(runDirectory)})\n`)
        return 0
      }
      case 'walkthrough': {
        const { catalog, catalogDir } = await loadCatalog(flags)
        const outRoot = flags.named.get('out-root')
        const environment = flags.named.get('env')
        const profileName = flags.named.get('profile')
        const destination = flags.named.get('dest')
        if (!outRoot || !environment || !profileName || !destination) {
          throw new Error('--out-root, --env, --profile and --dest are required')
        }
        const profileNames: Partial<Record<Surface, string>> = {}
        const environments: Partial<Record<Surface, string>> = {}
        for (const surface of ['web', 'ios', 'macos'] as const) {
          const named = flags.named.get(`profile-${surface}`)
          if (named) profileNames[surface] = named
          const env = flags.named.get(`env-${surface}`)
          if (env) environments[surface] = env
        }
        const { written, missing } = buildWalkthrough(catalog, {
          outRoot,
          environment,
          profileName,
          profileNames,
          environments,
          destination,
          currentDigest: digestDirectory(catalogDir),
          allowMixedAppRevision: flags.bare.has('allow-mixed-app-revision'),
        })
        for (const entry of missing) process.stderr.write(`missing: ${entry}\n`)
        process.stdout.write(`${written}\n`)
        return missing.length > 0 ? 1 : 0
      }
      default: {
        process.stderr.write(USAGE)
        return command ? 2 : 0
      }
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
