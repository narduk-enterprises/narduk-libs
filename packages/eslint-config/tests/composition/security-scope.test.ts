/**
 * ADVERSARIAL 5 — the packs have to reach a nested `server/` tree.
 *
 * `files` globs in flat config are resolved against the config's base path, so
 * `server/**` matches only a `server/` directory sitting directly at the lint
 * root. Every real monorepo, and every app linted from an outer `cwd`, puts the
 * tree one or more levels down. The adversarial pass linted
 * `<nested>/server/api/unwrapped.post.ts` — an unwrapped mutation handler
 * running `sql.raw(untrustedSql)` — and `--print-config` showed **no** server
 * security rules attached at all: not the wrapper rule, not CSRF, not the rate
 * limit, not query validation, not raw SQL, not the Drizzle bound.
 *
 * These are the print-config assertions for both nestings. They run against the
 * real ESLint config resolver rather than against the config array, because the
 * array being correct is exactly what the failure looked like: the rules were
 * all present and simply matched nothing.
 */

import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

type FlatConfig = Record<string, unknown>

interface AppConfigModule {
  composeSharedConfigs: (...presetNames: Array<string | string[]>) => FlatConfig[]
}

let appConfig: AppConfigModule

/** Rules that constitute the server security tier. Losing any is the bug. */
const SERVER_SECURITY_RULES = [
  'narduk/no-raw-define-event-handler-in-mutation-routes',
  'narduk/require-immediate-mutation-body-validation',
  'narduk/require-validated-query',
  'narduk/no-raw-sql-with-variable-input',
  'narduk/require-limit-on-drizzle-list-queries',
  'narduk/require-csrf-header-on-mutations',
  'narduk/no-csrf-exempt-route-misuse',
  'narduk/require-enforce-rate-limit-on-mutations',
  'narduk/prefer-safe-parse-in-event-handlers',
  'no-await-in-loop',
  'no-restricted-imports',
]

const CLOUDFLARE_RULES = [
  'narduk/no-process-env-in-worker-runtime',
  'narduk/no-worker-global-scope-db-clients',
  'narduk/no-worker-global-scope-operations',
]

/** The config ESLint itself computes for a file — `--print-config`, in-process. */
async function printConfig(filePath: string, packs: string[] = []): Promise<FlatConfig> {
  const eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: true,
    baseConfig: appConfig.composeSharedConfigs(...packs) as never,
  })
  return (await eslint.calculateConfigForFile(filePath)) as FlatConfig
}

function rulesOf(config: FlatConfig): Record<string, unknown> {
  return (config.rules ?? {}) as Record<string, unknown>
}

beforeAll(async () => {
  appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule
})

describe('server security rules reach a nested server/ tree', () => {
  // Root-level: what the pack was written against and always worked.
  const rootRoute = 'server/api/unwrapped.post.ts'
  // Nested: a package in a monorepo, an app linted from the repo root, or the
  // adversarial fixture's own `adversarial/nested-workspace/server/api/…`.
  const nestedRoute = 'apps/web/server/api/unwrapped.post.ts'
  const deeplyNestedRoute = 'packages/a/layers/b/server/routes/hooks/github.post.ts'

  for (const [label, filePath] of [
    ['root', rootRoute],
    ['nested one level', nestedRoute],
    ['nested three levels, server/routes', deeplyNestedRoute],
  ] as const) {
    it(`attaches every server security rule at ${label}`, async () => {
      const rules = rulesOf(await printConfig(filePath, ['server', 'auth']))

      for (const ruleId of SERVER_SECURITY_RULES) {
        expect(rules, `${ruleId} missing for ${filePath}`).toHaveProperty(ruleId)
      }
    })

    it(`attaches the Cloudflare worker rules at ${label}`, async () => {
      const rules = rulesOf(await printConfig(filePath, ['cloudflare']))

      for (const ruleId of CLOUDFLARE_RULES) {
        expect(rules, `${ruleId} missing for ${filePath}`).toHaveProperty(ruleId)
      }
    })
  }

  it('produces the same server rule set at both nestings', async () => {
    const packs = ['server', 'auth', 'template']
    const root = rulesOf(await printConfig(rootRoute, packs))
    const nested = rulesOf(await printConfig(nestedRoute, packs))

    for (const ruleId of SERVER_SECURITY_RULES) {
      expect(nested[ruleId], `${ruleId} differs between nestings`).toEqual(root[ruleId])
    }
  })

  it('attaches the worker rules to a nested workers/ tree', async () => {
    const rules = rulesOf(await printConfig('apps/edge/workers/queue-consumer.ts', ['cloudflare']))
    expect(rules).toHaveProperty('narduk/no-process-env-in-worker-runtime')
  })

  it('does not attach server rules to a file that is merely NAMED server', async () => {
    // The widening must not turn `app/utils/server.ts` into a Nitro route.
    // (`**/*.server.ts` is a Cloudflare worker-runtime glob, so this asserts on
    // the route-only half of the tier.)
    const rules = rulesOf(await printConfig('app/utils/servers.ts', ['server', 'auth']))
    expect(rules).not.toHaveProperty('narduk/require-csrf-header-on-mutations')
  })
})

/**
 * The nesting-safe globs also reach `tests/server/**`, which is not Nitro code.
 * Every bespoke rule shrugs that off — each derives its own exemption from the
 * filename — but the two CORE rules the packs carry have no such gate, so the
 * glob has to supply one. Without it a route suite importing its subject
 * relatively, and a deliberately sequential loop in a fixture, become errors in
 * every consumer at once.
 */
describe('core rules are gated out of test trees', () => {
  const UNGATED_CORE_RULES = ['no-restricted-imports', 'no-await-in-loop']

  it.each([
    'tests/server/upload.test.ts',
    'tests/server/api/things.post.ts',
    'packages/x/tests/server/helpers.ts',
    'server/api/__tests__/things.post.ts',
    'server/__fixtures__/seed.ts',
  ])('leaves the core rules unset for %s', async (filePath) => {
    const rules = rulesOf(await printConfig(filePath, ['server', 'auth', 'template']))

    for (const ruleId of UNGATED_CORE_RULES) {
      expect(rules, `${ruleId} should not apply to ${filePath}`).not.toHaveProperty(ruleId)
    }
  })

  it('still applies the core rules to real server code beside a test tree', async () => {
    const rules = rulesOf(
      await printConfig('packages/x/server/api/things.post.ts', ['server', 'auth', 'template']),
    )

    for (const ruleId of UNGATED_CORE_RULES) {
      expect(rules).toHaveProperty(ruleId)
    }
  })

  it('keeps the BESPOKE security rules on inside a test tree — they gate themselves', async () => {
    // The rules stay wired; `isExemptTestPath()` decides. Switching them off at
    // the glob would be a second, divergent exemption to keep in sync.
    const rules = rulesOf(await printConfig('tests/server/api/things.post.ts', ['server', 'auth']))
    expect(rules).toHaveProperty('narduk/no-raw-define-event-handler-in-mutation-routes')
    expect(rules).toHaveProperty('narduk/require-csrf-header-on-mutations')
  })
})
