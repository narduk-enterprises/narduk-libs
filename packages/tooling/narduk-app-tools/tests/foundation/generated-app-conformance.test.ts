/**
 * The end-to-end claim nothing else in this repository made: an app straight
 * out of `create-narduk-app`, untouched, is web-foundation conformant.
 *
 * Before narduk-libs#617 it was not, and could not be made so from inside the
 * app. The generated CI calls the shared workflow with `foundation-check:
 * true`, which fails the build on a `FAIL` **or** an `UNKNOWN` result, while a
 * fresh scaffold produced a decided FAIL on item 1.2 (`wrangler.jsonc` exists
 * but `Config/cloudflare-app.json` does not) plus UNKNOWNs on 1.4/3.1/3.2 for
 * the same missing file, and a FAIL on 1.1 as soon as a build had run
 * (narduk-libs#350). The first CI run of every new app was therefore red by
 * construction. `create-narduk-app`'s README documented that state as
 * "expected and not a generator defect"; it was one.
 *
 * One sub-check is deliberately red on an untouched scaffold, and that is the
 * honest verdict rather than a return of the defect above: 1.5 fails while the
 * `DB` binding still carries the all-zero placeholder `database_id`
 * (narduk-libs#662). The generator must not call Cloudflare, so it cannot know
 * the real id -- but a green gate over a database that does not exist is how
 * `narduk-farm` shipped a fully green first CI run that could not serve a
 * request. Unlike the #617 failures, one command inside the app clears it:
 * `narduk-app db create`. So the claim this file makes is exact: 1.5 is the
 * ONLY thing a fresh scaffold fails, and after `db create` (run here against
 * the real generator output, with Wrangler replaced at the process seam) the
 * app is conformant.
 *
 * The generator is imported from its SOURCE by relative path, never as a
 * dependency: `create-narduk-app` has no runtime dependencies and must not
 * gain one on this package, and the per-package CI gates run
 * `pnpm --filter <name>` without building a workspace sibling's `dist`. Source
 * import keeps that true in both directions -- the same reasoning
 * `generator.test.ts` uses to read this package's fixture by relative path.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createNardukApp, PACKAGE_VERSIONS } from '../../../create-narduk-app/src/index.js'
import { PLACEHOLDER_D1_DATABASE_ID, runD1Create } from '../../src/d1-create.js'
import { runFoundationCheck } from '../../src/foundation/evaluate.js'
import type { RegistryReality } from '../../src/foundation/npm-registry.js'
import { fakeReality, subCheckStatus } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** A registry that agrees with the generator's own pins: every package the
 * scaffold declares resolves, and the highest published major of narduk-core
 * is the major the generator pins. Derived from `PACKAGE_VERSIONS` rather than
 * hard-coded, so a pin bump cannot leave this fixture describing a registry
 * that does not match the app under test. */
function registryAgreeingWithGeneratorPins(): RegistryReality {
  const core = PACKAGE_VERSIONS['@narduk-enterprises/narduk-core']
  const eslintConfig = PACKAGE_VERSIONS['@narduk-enterprises/eslint-config']
  const majorOf = (version: string) => Number(version.split('.')[0])
  return fakeReality({
    installed: {
      '@narduk-enterprises/narduk-core': {
        version: core,
        major: majorOf(core),
        source: 'manifest-pin',
      },
      '@narduk-enterprises/eslint-config': {
        version: eslintConfig,
        major: majorOf(eslintConfig),
        source: 'manifest-pin',
      },
    },
    latestMajors: { '@narduk-enterprises/narduk-core': majorOf(core) },
  })
}

const PROVISIONED_ID = '3f2a9c1e-7b4d-4e8f-9a6b-1c2d3e4f5a6b'

/** `narduk-app db create` over the generated checkout, Wrangler replaced by
 * what `wrangler d1 create` prints -- the step onboarding runs before CI. */
function provision(dir: string): void {
  runD1Create(
    { checkoutDir: dir, env: { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) } },
    (args) =>
      `✅ Successfully created DB '${args[2]}'\n` +
      JSON.stringify({ d1_databases: [{ database_name: args[2], database_id: PROVISIONED_ID }] }),
  )
}

async function scaffold(options: {
  built: boolean
  provisioned?: boolean
  database?: 'd1' | 'none'
}): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'generated-app-conformance-'))
  tempDirs.push(root)
  const dir = join(root, 'app')
  await createNardukApp({
    appName: 'conformance-app',
    // `auth` needs the app database, so the database-free variant is a public
    // site without it (an authenticated app with no login fails 3.2).
    capabilities:
      options.database === 'none' ? ['seo', 'analytics'] : ['auth', 'seo', 'analytics', 'uploads'],
    exposure: options.database === 'none' ? 'public' : 'authenticated',
    ...(options.database ? { databaseBackend: options.database } : {}),
    // Long enough to cross the generated Prettier printWidth -- the shape
    // that shipped a pre-broken scaffold. Irrelevant to conformance, and
    // that is the point: the fixture is a realistic app, not a minimal one.
    description:
      'Youth running club site for Austin Rising Runners: season schedule, meets, results, ' +
      'roster and club information for member families.',
    noGit: true,
    targetDir: dir,
  })
  if (options.built) {
    // Exactly what Nitro writes after `pnpm run build:ci`. The canonical
    // preset name is hyphenated, and `.output/nitro.json` outranks the
    // `nuxt.config` literal in item 1.1's live-build fallback, so this is the
    // state a real CI run evaluates.
    mkdirSync(join(dir, 'apps/web/.output'), { recursive: true })
    writeFileSync(
      join(dir, 'apps/web/.output/nitro.json'),
      JSON.stringify({ preset: 'cloudflare-module' }),
    )
  }
  if (options.provisioned) provision(dir)
  return dir
}

function check(root: string, reality: RegistryReality | undefined) {
  return runFoundationCheck({
    root,
    toolVersion: '0.0.0-test',
    reality,
    appOverrides: { repo: 'narduk-enterprises/conformance-app', commit: 'a'.repeat(40) },
  })
}

describe('an app straight out of create-narduk-app', () => {
  it.each([
    { label: 'before its first build', built: false },
    { label: 'after build:ci has run', built: true },
  ])('fails exactly sub-check 1.5 -- the unprovisioned database -- $label', async ({ built }) => {
    const artefact = await check(await scaffold({ built }), registryAgreeingWithGeneratorPins())

    const notPassing = artefact.items
      .flatMap((item) => item.checks)
      .filter((sub) => sub.status === 'fail' || sub.status === 'unknown')
    expect(
      notPassing.map((sub) => `${sub.id}:${sub.status}`),
      JSON.stringify(notPassing),
    ).toEqual(['1.5:fail'])
    expect(artefact.failingItems).toEqual([1])
    expect(artefact.exitCode).toBe(1)
    // The failure names the one step that clears it.
    expect(notPassing[0]!.detail).toContain('`narduk-app db create`')
    expect(notPassing[0]!.detail).toContain('`wrangler d1 create conformance-app-db`')
  })

  it.each([
    { label: 'before its first build', built: false },
    { label: 'after build:ci has run', built: true },
  ])('is web-foundation conformant once db create has run, $label', async ({ built }) => {
    const dir = await scaffold({ built, provisioned: true })
    const wrangler = readFileSync(join(dir, 'apps/web/wrangler.jsonc'), 'utf8')
    expect(wrangler).toContain(`"database_id": "${PROVISIONED_ID}"`)
    expect(wrangler).not.toContain(PLACEHOLDER_D1_DATABASE_ID)
    // The generator's comments survive the write.
    expect(wrangler).toContain('// Workers Cache:')

    const artefact = await check(dir, registryAgreeingWithGeneratorPins())

    expect(artefact.failingItems, JSON.stringify(artefact.failingItems)).toEqual([])
    expect(artefact.score.unknown, JSON.stringify(artefact.items)).toBe(0)
    expect(artefact.result).toBe('PASS')
    // What CI actually reads: the shared workflow fails the build on any
    // nonzero exit, and UNKNOWN exits 2 just as FAIL exits 1.
    expect(artefact.exitCode).toBe(0)
  })

  it('is conformant untouched when scaffolded with --no-database', async () => {
    const artefact = await check(
      await scaffold({ built: true, database: 'none' }),
      registryAgreeingWithGeneratorPins(),
    )
    expect(subCheckStatus(artefact, '1.5')).toBe('not-applicable')
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
  })

  it('decides every sub-check the missing declaration used to leave open', async () => {
    const artefact = await check(
      await scaffold({ built: true, provisioned: true }),
      registryAgreeingWithGeneratorPins(),
    )

    // 1.1 reads the preset, 1.2 the bindings mirror -- both were FAIL.
    expect(subCheckStatus(artefact, '1.1')).toBe('pass')
    expect(subCheckStatus(artefact, '1.2')).toBe('pass')
    // 1.4/3.1/3.2 were UNKNOWN for want of access.exposureClass. An
    // `--exposure authenticated` scaffold is authenticated-public, so the
    // hardening flags apply and must be closed, the public-site checks do
    // not, and the login check does.
    expect(subCheckStatus(artefact, '1.4')).toBe('pass')
    expect(subCheckStatus(artefact, '3.1')).toBe('not-applicable')
    expect(subCheckStatus(artefact, '3.2')).toBe('pass')
  })

  /** Every name `FilesystemRegistryReality` will accept, absent rather than
   * empty: `??` treats an exported empty string as a value and stops there,
   * so clearing with '' would pin a different thing than an unset shell. */
  const clearRegistryCredentials = () => {
    for (const name of ['NODE_AUTH_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_PACKAGES_READ']) {
      vi.stubEnv(name, undefined)
    }
  }

  it('reports only the registry read as undecided when the registry is unreadable', async () => {
    // Why `foundation:check` is deliberately NOT chained into the generated
    // `quality:static`: offline, or without a package-read credential, item
    // 2.3 is honestly UNKNOWN and the command exits 2. Chaining it would put
    // a red on a laptop that CI does not have -- the exact local/CI
    // divergence narduk-libs#617 is about, pointed the other way. The
    // generated README states this; this test is what keeps it true.
    // "Without a credential" has to be something this test ESTABLISHES, not
    // something it inherits. Passing `undefined` here builds the real reader,
    // which resolves its token from the environment, so the assertion below
    // was really asserting that the machine running it had no package-read
    // credential exported. It held until `gh-packages-run` -- the sanctioned
    // local route, which exports GH_PACKAGES_READ -- became a name the reader
    // consults: `pnpm run ci:affected` runs under it, the reader found a
    // token, made a live read, and this went PASS. Green on a bare runner and
    // red on a workstation is the same local/CI divergence the comment above
    // is about, pointed the other way once more (agent-infrastructure#1644).
    clearRegistryCredentials()
    // Clearing credentials stopped being enough when the generator moved the
    // scaffold's `.npmrc` to the anonymous `https://npm.nard.uk` mirror
    // (D-PKG-6, narduk-libs#821): the reader follows that route with no
    // credential at all, so wherever the mirror answers -- every CI runner --
    // the live read succeeded and this went PASS (narduk-libs#846). The
    // network is the other half of "unreadable", so the test establishes that
    // too: every request the real reader makes fails the way a dead link
    // does. Nothing the reader decides is faked -- its route, retry budget and
    // fail-closed answer all still run.
    const requests: Array<{ url: string; headers: Record<string, string> }> = []
    vi.stubGlobal('fetch', (url: string, init?: { headers?: Record<string, string> }) => {
      requests.push({ url, headers: init?.headers ?? {} })
      return Promise.reject(new TypeError('fetch failed'))
    })
    const artefact = await check(await scaffold({ built: true, provisioned: true }), undefined)

    // Whatever the reader tried, it tried without a credential: the cleared
    // environment reached it, and the anonymous route never carries one.
    expect(requests.filter((request) => 'Authorization' in request.headers)).toEqual([])
    expect(artefact.failingItems).toEqual([])
    expect(artefact.result).toBe('UNKNOWN')
    expect(subCheckStatus(artefact, '2.3')).toBe('unknown')
    expect(
      artefact.items
        .flatMap((item) => item.checks)
        .filter((sub) => sub.status === 'unknown')
        .map((sub) => sub.id),
    ).toEqual(['2.3'])
  })
})
