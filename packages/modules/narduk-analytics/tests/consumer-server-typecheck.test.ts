import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(__dirname, '..')
const require = createRequire(import.meta.url)

/** Building the whole program from scratch runs well past vitest's 5s default. */
const TYPECHECK_TIMEOUT_MS = 120_000

const PROBE_FILE = 'tests/fixtures/__consumer-probe.generated.ts'
const probePath = join(packageRoot, PROBE_FILE)

interface Diagnostic {
  code: string
  file: string
  message: string
  position: string
}

const DIAGNOSTIC_PATTERN =
  /^(?<file>[^(]+)\((?<position>\d+,\d+)\): error (?<code>TS\d+): (?<message>.*)$/u

function runConsumerTypecheck(): Diagnostic[] {
  const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')

  let output: string
  try {
    output = execFileSync(process.execPath, [tsc, '-p', 'tsconfig.consumer-server.json'], {
      cwd: packageRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    // tsc exits non-zero when it reports diagnostics; the diagnostics are the
    // result we want, so a non-zero exit is expected rather than a failure.
    const failure = error as { stderr?: string; stdout?: string }
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`
  }

  return output
    .split('\n')
    .map((line) => DIAGNOSTIC_PATTERN.exec(line.trim())?.groups)
    .filter((groups): groups is Record<string, string> => Boolean(groups))
    .map((groups) => ({
      code: groups.code,
      file: groups.file,
      message: groups.message,
      position: groups.position,
    }))
}

/**
 * narduk-libs#621: `@narduk-enterprises/narduk-analytics` ships raw `.ts`, and
 * a consumer compiles it inside its own Nitro type program — where the
 * runtime-config augmentation this module registers does not take effect. Every
 * `runtimeConfig` key is `unknown` there (`@nuxt/schema`'s `RuntimeConfig`
 * extends `Record<string, unknown>`) and a truthiness guard narrows `unknown`
 * to `{}`, so `config.ownerTagSecret` flowing into a `string` failed in every
 * consumer while this package's own `nuxt typecheck` stayed green, because that
 * one *does* see the augmentation.
 *
 * `tsconfig.consumer-server.json` reproduces the consumer's view — the shipped
 * `server/**` with no `.nuxt/**` and no augmentation — so the gap that let #621
 * ship cannot reopen silently. Reverting `server/utils/runtimeConfig.ts` and
 * putting a direct `useRuntimeConfig(event)` back into a handler fails this
 * test.
 */
describe('published server sources typecheck in an unaugmented consumer context', () => {
  it(
    'reports no diagnostics for this package own server sources',
    () => {
      const diagnostics = runConsumerTypecheck()
      const ours = diagnostics.filter((diagnostic) => !diagnostic.file.startsWith('..'))

      expect(
        ours.map((d) => `${d.file}(${d.position}): ${d.code}: ${d.message}`),
        'shipped server sources must not depend on a consumer-side runtime-config augmentation',
      ).toEqual([])
    },
    TYPECHECK_TIMEOUT_MS,
  )

  it(
    'still rejects the narduk-libs#621 pattern it was built to catch',
    () => {
      // A gate like this decays into a no-op the moment its project stops
      // resolving the sources, so it re-proves its own teeth: the probe is the
      // shape `server/api/owner-tag.post.ts` had when #621 was filed -- a
      // runtime-config key read straight into a `string` -- and this project must
      // still reject it.
      writeFileSync(
        probePath,
        [
          "import { timingSafeEqual } from '#narduk-analytics-server/utils/owner-tag-proof'",
          '',
          "import type { H3Event } from 'h3'",
          '',
          'export function probeOwnerSecret(event: H3Event): boolean {',
          '  const config = useRuntimeConfig(event)',
          '  const ownerSecret = config.ownerTagSecret',
          '  if (!ownerSecret) return false',
          "  return timingSafeEqual('probe', ownerSecret)",
          '}',
          '',
        ].join('\n'),
      )

      try {
        const diagnostics = runConsumerTypecheck().filter((diagnostic) =>
          diagnostic.file.endsWith(PROBE_FILE),
        )

        expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('TS2345')
      } finally {
        rmSync(probePath, { force: true })
      }
    },
    TYPECHECK_TIMEOUT_MS,
  )
})
