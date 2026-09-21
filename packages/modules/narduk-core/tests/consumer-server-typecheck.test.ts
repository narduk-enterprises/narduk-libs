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

/**
 * Vitest's timer cannot interrupt `execFileSync`, which blocks the worker.
 * The child gets its own deadline, short of the test deadline, so a stuck
 * compiler is killed and the test still has time to report that.
 */
const COMPILER_TIMEOUT_MS = TYPECHECK_TIMEOUT_MS - 30_000

const PROBE_FILE = 'tests/fixtures/__consumer-probe.generated.ts'
const probePath = join(packageRoot, PROBE_FILE)

interface Diagnostic {
  code: string
  /** Null for a diagnostic tsc prints without a file position, such as TS2688. */
  file: string | null
  message: string
  position: string | null
}

interface TypecheckResult {
  diagnostics: Diagnostic[]
  files: string[]
  status: number
}

interface CapturedProcess {
  output: string
  status: number
}

interface ProcessFailure extends Error {
  code?: string
  signal?: string | null
  status?: number | null
  stderr?: string
  stdout?: string
}

const FILE_DIAGNOSTIC_PATTERN =
  /^(?<file>[^(]+)\((?<position>\d+,\d+)\): error (?<code>TS\d+): (?<message>.*)$/u

const GLOBAL_DIAGNOSTIC_PATTERN = /^error (?<code>TS\d+): (?<message>.*)$/u

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

/**
 * Split `tsc --listFiles --pretty false` output into diagnostics and the file
 * list. A global diagnostic (`error TS2688: ...`) has no `file(line,col)`
 * prefix, and tsc then prints its explanation indented. Treating either as a
 * filename drops the error out of the assertion.
 */
function parseTscListFilesOutput(output: string): Pick<TypecheckResult, 'diagnostics' | 'files'> {
  const diagnostics: Diagnostic[] = []
  const files: string[] = []

  for (const line of output.split('\n')) {
    if (!line.trim()) continue

    if (/^\s/.test(line)) {
      const current = diagnostics.at(-1)
      if (current) {
        current.message = `${current.message}\n${line.trim()}`
        continue
      }
      diagnostics.push({
        code: 'unparsed',
        file: null,
        message: line.trim(),
        position: null,
      })
      continue
    }

    const trimmed = line.trim()
    const fileDiagnostic = FILE_DIAGNOSTIC_PATTERN.exec(trimmed)?.groups
    if (fileDiagnostic) {
      diagnostics.push({
        code: fileDiagnostic.code,
        file: fileDiagnostic.file,
        message: fileDiagnostic.message,
        position: fileDiagnostic.position,
      })
      continue
    }

    const globalDiagnostic = GLOBAL_DIAGNOSTIC_PATTERN.exec(trimmed)?.groups
    if (globalDiagnostic) {
      diagnostics.push({
        code: globalDiagnostic.code,
        file: null,
        message: globalDiagnostic.message,
        position: null,
      })
      continue
    }

    if (trimmed.includes('error TS')) {
      diagnostics.push({ code: 'unparsed', file: null, message: trimmed, position: null })
      continue
    }

    files.push(trimmed)
  }

  return { diagnostics, files }
}

function runCaptured(file: string, args: string[], timeoutMs: number): CapturedProcess {
  try {
    return {
      status: 0,
      output: execFileSync(file, args, {
        cwd: packageRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
        killSignal: 'SIGTERM',
      }),
    }
  } catch (error) {
    const failure = error as ProcessFailure
    // A non-zero exit is tsc reporting diagnostics. No exit status means the
    // process never finished: a timeout, a signal, or a failure to spawn.
    if (failure.code === 'ETIMEDOUT' || failure.signal || failure.status == null) {
      throw new Error(
        `${file} did not finish (code ${failure.code ?? 'none'}, signal ${failure.signal ?? 'none'}, status ${failure.status ?? 'null'})`,
        { cause: error },
      )
    }
    return {
      status: failure.status,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    }
  }
}

function runConsumerTypecheck(): TypecheckResult {
  const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
  const captured = runCaptured(
    process.execPath,
    [tsc, '-p', 'tsconfig.consumer-server.json', '--listFiles', '--pretty', 'false'],
    COMPILER_TIMEOUT_MS,
  )
  return { status: captured.status, ...parseTscListFilesOutput(captured.output) }
}

function isOwnSource(file: string): boolean {
  const normalized = file.replaceAll('\\', '/')
  return !normalized.startsWith('..') && !normalized.includes('/node_modules/')
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  const where = diagnostic.file ? `${diagnostic.file}(${diagnostic.position})` : 'global'
  return `${where}: ${diagnostic.code}: ${diagnostic.message}`
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
  it('kills a compiler that outlives its own deadline and reports that as the failure', () => {
    expect(() =>
      runCaptured(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)'], 200),
    ).toThrow(/ETIMEDOUT/)
  })

  it('keeps a diagnostic that has no file position out of the file list', () => {
    const parsed = parseTscListFilesOutput(
      [
        "error TS2688: Cannot find type definition file for 'missing'.",
        '  The file is in the program because:',
        "    Entry point of type library 'missing' specified in compilerOptions",
        "src/file.ts(12,14): error TS2538: Type '{}' cannot be used as an index type.",
        '/tmp/listed.ts',
        '',
      ].join('\n'),
    )

    expect(parsed.files).toEqual(['/tmp/listed.ts'])
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['TS2688', 'TS2538'])
    expect(parsed.diagnostics[0]).toMatchObject({
      file: null,
      message: [
        "Cannot find type definition file for 'missing'.",
        'The file is in the program because:',
        "Entry point of type library 'missing' specified in compilerOptions",
      ].join('\n'),
    })
  })

  it(
    'compiles every shipped server source, and reports no diagnostics for them',
    () => {
      rmSync(probePath, { force: true })
      const result = runConsumerTypecheck()
      const missing = shippedServerSources().filter(
        (source) => !result.files.some((listed) => listed.endsWith(relative(packageRoot, source))),
      )
      const global = result.diagnostics.filter((diagnostic) => diagnostic.file === null)
      const ours = result.diagnostics.filter(
        (diagnostic) => diagnostic.file !== null && isOwnSource(diagnostic.file),
      )

      expect(
        missing.map((source) => relative(packageRoot, source)),
        'the consumer project must typecheck every shipped server file, or it can go green by compiling nothing',
      ).toEqual([])

      // `status` is what makes a diagnostic the parser did not recognize fail
      // this test anyway. `global` is where TS2688 is reported, with its text.
      expect({
        status: result.status,
        global: global.map(formatDiagnostic),
        own: ours.map(formatDiagnostic),
      }).toEqual({ status: 0, global: [], own: [] })
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
        const result = runConsumerTypecheck()
        const probe = result.diagnostics.filter((diagnostic) =>
          diagnostic.file?.endsWith(PROBE_FILE),
        )
        const global = result.diagnostics.filter((diagnostic) => diagnostic.file === null)

        expect({
          status: result.status,
          global: global.map(formatDiagnostic),
          probe: probe.map((diagnostic) => diagnostic.code),
        }).toEqual({ status: 2, global: [], probe: ['TS2538'] })
      } finally {
        rmSync(probePath, { force: true })
      }
    },
    TYPECHECK_TIMEOUT_MS,
  )
})
