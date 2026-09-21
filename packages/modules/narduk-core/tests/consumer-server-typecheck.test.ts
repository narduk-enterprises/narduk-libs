import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(__dirname, '..')
const require = createRequire(import.meta.url)

/** Building the whole server program from scratch runs well past vitest's 5s default. */
const TYPECHECK_TIMEOUT_MS = 180_000

const PROBE_FILE = 'tests/fixtures/__consumer-probe.generated.ts'
const probePath = join(packageRoot, PROBE_FILE)

interface Diagnostic {
  code: string
  file: string
  message: string
  position: string
}

interface TypecheckResult {
  diagnostics: Diagnostic[]
  files: string[]
}

const DIAGNOSTIC_PATTERN =
  /^(?<file>[^(]+)\((?<position>\d+,\d+)\): error (?<code>TS\d+): (?<message>.*)$/u

function shippedServerSources(): string[] {
  const root = join(packageRoot, 'runtime', 'server')
  const files: string[] = []

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (entry.name.endsWith('.ts')) files.push(path)
    }
  }

  walk(root)
  return files
}

function runConsumerTypecheck(): TypecheckResult {
  const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')

  let output: string
  try {
    output = execFileSync(
      process.execPath,
      [tsc, '-p', 'tsconfig.consumer-server.json', '--listFiles', '--pretty', 'false'],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
  } catch (error) {
    // tsc exits non-zero when it reports diagnostics; the diagnostics are the
    // result we want, so a non-zero exit is expected rather than a failure.
    const failure = error as { stderr?: string; stdout?: string }
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`
  }

  const diagnostics: Diagnostic[] = []
  const files: string[] = []
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const groups = DIAGNOSTIC_PATTERN.exec(trimmed)?.groups
    if (groups) {
      diagnostics.push({
        code: groups.code,
        file: groups.file,
        message: groups.message,
        position: groups.position,
      })
      continue
    }
    files.push(trimmed)
  }

  return { diagnostics, files }
}

function isOwnSource(file: string): boolean {
  const normalized = file.replaceAll('\\', '/')
  return !normalized.startsWith('..') && !normalized.includes('/node_modules/')
}

/**
 * narduk-libs#656: `@narduk-enterprises/narduk-core` ships raw `.ts`, and a
 * consumer compiles it inside its own Nitro type program — where the
 * runtime-config augmentation this module registers does not take effect.
 * `hyperdriveBinding` is `unknown` there, `|| 'HYPERDRIVE'` narrows that to
 * `{} | string`, and indexing a `Record` with it is TS2538. This package's own
 * `nuxt typecheck` stays green because that one *does* see the augmentation.
 *
 * `tsconfig.consumer-server.json` reproduces the consumer's view. Reverting
 * `runtime/server/utils/runtime-config.ts` and reading `useRuntimeConfig`
 * straight from `hyperdrive.ts` fails this test.
 */
describe('published server sources typecheck in an unaugmented consumer context', () => {
  it(
    'compiles every shipped server source, and reports no diagnostics for them',
    () => {
      rmSync(probePath, { force: true })
      const { diagnostics, files } = runConsumerTypecheck()
      const missing = shippedServerSources().filter(
        (source) => !files.some((listed) => listed.endsWith(relative(packageRoot, source))),
      )

      expect(
        missing.map((source) => relative(packageRoot, source)),
        'the consumer project must typecheck every shipped server file, or it can go green by compiling nothing',
      ).toEqual([])

      const ours = diagnostics.filter((diagnostic) => isOwnSource(diagnostic.file))
      expect(
        ours.map(
          (diagnostic) =>
            `${diagnostic.file}(${diagnostic.position}): ${diagnostic.code}: ${diagnostic.message}`,
        ),
        'shipped server sources must not depend on a consumer-side runtime-config augmentation',
      ).toEqual([])
    },
    TYPECHECK_TIMEOUT_MS,
  )

  it(
    'still rejects the narduk-libs#656 pattern it was built to catch',
    () => {
      // A gate like this decays into a no-op the moment its project stops
      // seeing `unknown` keys, so it re-proves its own teeth: the probe is the
      // shape `runtime/server/utils/hyperdrive.ts` had when #656 was filed.
      writeFileSync(
        probePath,
        [
          "import { useRuntimeConfig } from 'nitropack/runtime'",
          '',
          "import { useHyperdriveConnectionString } from '../../runtime/server/utils/hyperdrive'",
          '',
          "import type { H3Event } from 'h3'",
          '',
          'export function probe(event: H3Event): unknown {',
          '  const connected = useHyperdriveConnectionString(event)',
          '  const { hyperdriveBinding } = useRuntimeConfig(event)',
          "  const name = hyperdriveBinding || 'HYPERDRIVE'",
          '  const env: Record<string, unknown> = {}',
          '  return env[name] ?? connected',
          '}',
          '',
        ].join('\n'),
      )

      try {
        const diagnostics = runConsumerTypecheck().diagnostics.filter((diagnostic) =>
          diagnostic.file.endsWith(PROBE_FILE),
        )

        expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['TS2538'])
      } finally {
        rmSync(probePath, { force: true })
      }
    },
    TYPECHECK_TIMEOUT_MS,
  )
})
