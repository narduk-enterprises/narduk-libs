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
 * The generator is imported from its SOURCE by relative path, never as a
 * dependency: `create-narduk-app` has no runtime dependencies and must not
 * gain one on this package, and the per-package CI gates run
 * `pnpm --filter <name>` without building a workspace sibling's `dist`. Source
 * import keeps that true in both directions -- the same reasoning
 * `generator.test.ts` uses to read this package's fixture by relative path.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createNardukApp, PACKAGE_VERSIONS } from '../../../create-narduk-app/src/index.js'
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

async function scaffold(options: { built: boolean }): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'generated-app-conformance-'))
  tempDirs.push(root)
  const dir = join(root, 'app')
  await createNardukApp({
    appName: 'conformance-app',
    capabilities: ['auth', 'seo', 'analytics', 'uploads'],
    exposure: 'authenticated',
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
  ])('is web-foundation conformant $label', async ({ built }) => {
    const artefact = await check(await scaffold({ built }), registryAgreeingWithGeneratorPins())

    expect(artefact.failingItems, JSON.stringify(artefact.failingItems)).toEqual([])
    expect(artefact.score.unknown, JSON.stringify(artefact.items)).toBe(0)
    expect(artefact.result).toBe('PASS')
    // What CI actually reads: the shared workflow fails the build on any
    // nonzero exit, and UNKNOWN exits 2 just as FAIL exits 1.
    expect(artefact.exitCode).toBe(0)
  })

  it('decides every sub-check the missing declaration used to leave open', async () => {
    const artefact = await check(
      await scaffold({ built: true }),
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
    // `quality:static`: offline, item 2.3 is honestly UNKNOWN and the command
    // exits 2. Chaining it would put a red on a laptop that CI does not have
    // -- the exact local/CI divergence narduk-libs#617 is about, pointed the
    // other way. The generated README states this; this test is what keeps
    // it true.
    //
    // "Unreadable" has to be something this test ESTABLISHES, not something
    // it inherits. Passing `undefined` here builds the real reader, so the
    // test takes away every way that reader could get an answer:
    //
    // - Credentials. The reader resolves a GitHub Packages token from the
    //   environment, and `gh-packages-run` -- the sanctioned local route,
    //   which exports GH_PACKAGES_READ -- once turned this PASS on a
    //   workstation while a bare runner stayed green (agent-infrastructure#1644).
    // - The network. Since narduk-libs#821 the generator routes
    //   `@narduk-enterprises` to the anonymous npm.nard.uk mirror (D-PKG-6),
    //   so clearing credentials alone no longer makes the registry
    //   unreadable: the reader made a live, anonymous, successful read and
    //   every CI run went PASS (narduk-libs#846). Offline is the state the
    //   README's claim is about, so fetch fails here the way it does on an
    //   offline machine, and the test never depends on the network.
    clearRegistryCredentials()
    const fetchedUrls: string[] = []
    const sentAuthorization: boolean[] = []
    vi.stubGlobal('fetch', (url: string, init?: { headers?: Record<string, string> }) => {
      fetchedUrls.push(String(url))
      sentAuthorization.push(init?.headers?.Authorization !== undefined)
      return Promise.reject(new TypeError('fetch failed'))
    })
    const artefact = await check(await scaffold({ built: true }), undefined)

    expect(artefact.failingItems).toEqual([])
    expect(artefact.result).toBe('UNKNOWN')
    expect(subCheckStatus(artefact, '2.3')).toBe('unknown')
    expect(
      artefact.items
        .flatMap((item) => item.checks)
        .filter((sub) => sub.status === 'unknown')
        .map((sub) => sub.id),
    ).toEqual(['2.3'])
    // The read really was attempted, against the generated anonymous route,
    // with no credential -- so the UNKNOWN above is the offline answer, not a
    // short-circuit on a route this scaffold does not use.
    expect(fetchedUrls.length).toBeGreaterThan(0)
    expect(fetchedUrls.every((url) => url.startsWith('https://npm.nard.uk/'))).toBe(true)
    expect(sentAuthorization).not.toContain(true)
  })
})
