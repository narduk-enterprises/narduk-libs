import { defaultDeploymentBlock } from '../../src/deployment-config.js'
import type { AdoptionLiveReality } from '../../src/foundation/evaluate-adoption.js'
import type { DependabotReality } from '../../src/foundation/evaluate-nac-status.js'
import type { HeaderProbe } from '../../src/foundation/evaluate-security-headers.js'
import type { RegistryReality } from '../../src/foundation/npm-registry.js'
import { fakeReality, writeConformantBaseline, writeFile, writeJson } from './helpers.js'

/** The conformant-app fixtures the adoption report's tests share
 * (`adoption.test.ts`, `nac-status.test.ts`). */

export const SHA = '48ba389bdb1b7ab8baadc17b8c234dcf426c7329'
export const NODE = '24.21.0'
export const PNPM = '10.33.4'

/**
 * The checker version the tests inject. `runAdoptionCheck` takes it as an
 * input -- the CLI passes `readOwnVersion()` -- so the assertion proves the
 * artefact carries the version it was handed, whatever that is. The value is
 * deliberately not a plausible release number: a three-part literal here
 * reads as this package's own manifest version, which is the copy-paste shape
 * `scripts/package-version-assertions.test.mjs` exists to keep out of a
 * package's tests (narduk-libs#291, #297).
 */
export const TOOL_VERSION = '0.0.0-fixture'

/** Every estate package the baseline pins, at the version it pins. */
export const BASELINE_PINS: Record<string, string> = {
  '@narduk-enterprises/eslint-config': '2.0.0',
  '@narduk-enterprises/narduk-analytics': '1.0.0',
  '@narduk-enterprises/narduk-app-tools': '0.1.3',
  '@narduk-enterprises/narduk-core': '3.4.1',
  '@narduk-enterprises/narduk-seo': '1.0.0',
  '@narduk-enterprises/narduk-testkit': '2.0.0',
}

/** A registry that publishes exactly what the baseline pins, so requirement 2
 * is DECIDED rather than undecided. An `unreadable` row would make the report
 * UNKNOWN for a reason that has nothing to do with the case under test. */
export function baselineReality(extraPins: Record<string, string> = {}): RegistryReality {
  const pins = { ...BASELINE_PINS, ...extraPins }
  const installed: Record<string, { version: string; major: number; source: 'manifest-pin' }> = {}
  const publications: Record<string, { status: 'published'; latest: string; major: number }> = {}
  for (const [name, version] of Object.entries(pins)) {
    const major = Number(version.split('.')[0])
    installed[name] = { major, source: 'manifest-pin', version }
    publications[name] = { latest: version, major, status: 'published' }
  }
  return fakeReality({ installed, publications })
}

/**
 * A genuinely conformant app: the seven-item baseline, plus the toolchain
 * single source, a valid deployment block, and app source for the
 * reimplementation scan to read.
 *
 * It has to be all four. A fixture that failed one of them would make every
 * assertion about how verdicts compose pass for the wrong reason -- which is
 * what the first draft of this file did, reporting FAIL from a missing
 * `.node-version` while claiming to test manual-requirement handling.
 */
export function writeAdoptionBaseline(root: string): void {
  writeConformantBaseline(root)
  writeFile(root, '.node-version', `${NODE}\n`)
  writeJson(root, 'package.json', {
    dependencies: BASELINE_PINS,
    engines: { node: NODE },
    name: 'fixture-app',
    packageManager: `pnpm@${PNPM}`,
    scripts: { 'manifests:validate': 'true' },
  })
  writeFile(
    root,
    '.github/workflows/ci.yml',
    [
      'name: ci',
      'jobs:',
      '  build:',
      '    uses: narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@v1',
      '    with:',
      "      node-version-file: '.node-version'",
      '      package-manager: pnpm',
    ].join('\n'),
  )
  writeJson(root, 'Config/cloudflare-app.json', {
    access: { exposureClass: 'public' },
    bindings: { r2: [] },
    deployment: defaultDeploymentBlock({ appSlug: 'fixture' }),
    product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
    schemaVersion: 1,
    worker: { nitroPreset: 'cloudflare_module' },
  })
  writeJson(root, 'wrangler.json', { name: 'fixture', workers_dev: false })
  // Item 9 reports `unknown` when it finds no app source to scan, which would
  // hold the whole report at UNKNOWN for a reason unrelated to any case here.
  writeFile(root, 'app/app.vue', '<template><div>fixture</div></template>\n')
}

/** The header set a fully adopted app serves. Item 10 has its own exhaustive
 * suite; here it only has to be a set that passes, so a case about verdict
 * composition is not really a case about headers. */
export const CONFORMANT_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; " +
    "frame-ancestors 'none'; script-src 'self' 'nonce-Ab12' 'strict-dynamic'; " +
    "style-src 'self' 'unsafe-inline'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=15552000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
}

/** Item 10's probe, answered from the fixture. WITHOUT this a test that passes
 * `liveUrl` reaches the real origin over the network, and a green requirement
 * 8 would be evidence about production rather than about this code -- which is
 * exactly what the first run of this file did. */
export const fakeHeaderProbe: HeaderProbe = async (url) => ({
  headers: CONFORMANT_HEADERS,
  status: 200,
  url,
})

/** A live origin that serves one build stamp and a healthy health route. */
export function fakeLive(
  headers: Record<string, string>,
  healthStatus: number | null = 200,
): AdoptionLiveReality {
  return {
    async read(url) {
      if (url.endsWith('/api/health')) return { headers: {}, status: healthStatus }
      return { headers, status: 200 }
    },
  }
}

/** The Dependabot read, answered from the fixture, for the same reason the live
 * and header probes are: a default would reach GitHub with whatever token the
 * test run happens to hold. */
export const NO_ALERTS: DependabotReality = { read: async () => ({ alerts: [], kind: 'read' }) }
