import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import {
  ADOPTION_REQUIREMENT_COUNT,
  matchesCommit,
  runAdoptionCheck,
  type AdoptionArtefact,
  type AdoptionLiveReality,
  type AdoptionRequirement,
} from '../../src/foundation/evaluate-adoption.js'
import type { HeaderProbe } from '../../src/foundation/evaluate-security-headers.js'
import { parseAdoptionReportArgs } from '../../src/commands/adoption-report.js'
import { runDoctor } from '../../src/doctor.js'
import { runFoundationCheck } from '../../src/foundation/evaluate.js'
import { defaultDeploymentBlock } from '../../src/deployment-config.js'
import type { RegistryReality } from '../../src/foundation/npm-registry.js'
import {
  fakeReality,
  makeTempRepo,
  writeConformantBaseline,
  writeFile,
  writeJson,
} from './helpers.js'

const SHA = '48ba389bdb1b7ab8baadc17b8c234dcf426c7329'
const NODE = '24.21.0'
const PNPM = '10.33.4'

/**
 * The checker version the tests inject. `runAdoptionCheck` takes it as an
 * input -- the CLI passes `readOwnVersion()` -- so the assertion proves the
 * artefact carries the version it was handed, whatever that is. The value is
 * deliberately not a plausible release number: a three-part literal here
 * reads as this package's own manifest version, which is the copy-paste shape
 * `scripts/package-version-assertions.test.mjs` exists to keep out of a
 * package's tests (narduk-libs#291, #297).
 */
const TOOL_VERSION = '0.0.0-fixture'

/** Every estate package the baseline pins, at the version it pins. */
const BASELINE_PINS: Record<string, string> = {
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
function baselineReality(extraPins: Record<string, string> = {}): RegistryReality {
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
function writeAdoptionBaseline(root: string): void {
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

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

/** The header set a fully adopted app serves. Item 10 has its own exhaustive
 * suite; here it only has to be a set that passes, so a case about verdict
 * composition is not really a case about headers. */
const CONFORMANT_HEADERS: Record<string, string> = {
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
const fakeHeaderProbe: HeaderProbe = async (url) => ({
  headers: CONFORMANT_HEADERS,
  status: 200,
  url,
})

/** A live origin that serves one build stamp and a healthy health route. */
function fakeLive(
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

async function run(
  write: (root: string) => void = writeAdoptionBaseline,
  options: Partial<Parameters<typeof runAdoptionCheck>[0]> = {},
): Promise<AdoptionArtefact> {
  const root = makeTempRepo()
  tempDirs.push(root)
  write(root)
  return runAdoptionCheck({
    reality: baselineReality(),
    root,
    toolVersion: TOOL_VERSION,
    ...options,
  })
}

function req(artefact: AdoptionArtefact, id: string): AdoptionRequirement {
  const found = artefact.requirements.find((r) => r.id === id)
  if (!found) throw new Error(`no ${id} in report`)
  return found
}

describe('the adoption report', () => {
  it('reports all fifteen requirements, once each, in order', async () => {
    const artefact = await run()

    expect(artefact.requirements).toHaveLength(ADOPTION_REQUIREMENT_COUNT)
    expect(artefact.requirements.map((r) => r.id)).toEqual(
      Array.from({ length: 15 }, (_, index) => `R${index + 1}`),
    )
  })

  it('never passes a requirement it cannot decide', async () => {
    const artefact = await run()

    for (const requirement of artefact.requirements) {
      if (requirement.enforcement !== 'manual') continue
      expect(requirement.verdict).toBe('unknown')
      expect(artefact.manualReview).toContain(requirement.id)
    }
    // And there is genuinely something it cannot decide -- a report whose
    // manual list came back empty would mean this assertion proved nothing.
    expect(artefact.manualReview.length).toBeGreaterThan(0)
  })

  it('does not let a manual requirement hold the whole report at UNKNOWN', async () => {
    // R11, R13 and R14 are manual and always unknown. If they counted toward
    // `result`, no app could ever reach PASS and the verdict would carry no
    // information at all.
    const artefact = await run()
    const manual = artefact.requirements.filter((r) => r.enforcement === 'manual')

    expect(manual.length).toBeGreaterThan(0)
    expect(manual.every((r) => r.verdict === 'unknown')).toBe(true)
    expect(artefact.result).not.toBe('FAIL')
  })

  it('a machine-decidable unknown does hold the report at UNKNOWN', async () => {
    // No --live, so R8 (live headers) is undecided and enforced. That must
    // reach the top-level verdict.
    const artefact = await run()

    expect(req(artefact, 'R8').verdict).toBe('unknown')
    expect(req(artefact, 'R8').enforcement).toBe('enforced')
    expect(artefact.result).toBe('UNKNOWN')
    expect(artefact.exitCode).toBe(2)
  })

  it('a failing check fails the report and names the owner', async () => {
    const artefact = await run((root) => {
      writeAdoptionBaseline(root)
      // A range spec: exactly the unreproducible pin requirement 2 refuses.
      writeJson(root, 'apps/web/package.json', {
        dependencies: { '@narduk-enterprises/narduk-core': '^3.4.1' },
      })
    })

    const currency = req(artefact, 'R2')
    expect(currency.verdict).toBe('fail')
    expect(currency.owner).toBe('the app repository')
    expect(artefact.result).toBe('FAIL')
    expect(artefact.exitCode).toBe(1)
  })

  it('reports the package evidence as data, not only as prose', async () => {
    const artefact = await run()

    expect(artefact.packages.length).toBeGreaterThan(0)
    for (const row of artefact.packages) {
      expect(row.package.startsWith('@narduk-enterprises/')).toBe(true)
      expect(typeof row.status).toBe('string')
    }
  })

  it('carries the checker version, the standard, and the commit under review', async () => {
    const artefact = await run(writeAdoptionBaseline, {
      appOverrides: { commit: SHA, ref: 'refs/heads/main' },
    })

    expect(artefact.toolVersion).toBe(TOOL_VERSION)
    expect(artefact.standard.requirements).toBe(15)
    expect(artefact.standard.source).toContain('company-hq')
    expect(artefact.app.commit).toBe(SHA)
  })

  it('does not change the seven-item artefact', async () => {
    // The ratified contract has its own consumers. Growing it to carry
    // adoption would break every one of them, so this report is a separate
    // document with its own tool name.
    const root = makeTempRepo()
    tempDirs.push(root)
    writeAdoptionBaseline(root)

    const foundation = await runFoundationCheck({
      reality: baselineReality(),
      root,
      toolVersion: TOOL_VERSION,
    })
    const adoption = await runAdoptionCheck({
      reality: baselineReality(),
      root,
      toolVersion: TOOL_VERSION,
    })

    expect(foundation.items).toHaveLength(7)
    expect(foundation.contract.items).toBe(7)
    expect(adoption.tool).not.toBe(foundation.tool)
    expect(adoption).not.toHaveProperty('items')
  })
})

describe('the live half', () => {
  it('leaves the deployed-commit question unknown when no origin was given', async () => {
    const artefact = await run()

    expect(artefact.live).toBeNull()
    expect(req(artefact, 'R5').verdict).toBe('unknown')
    expect(req(artefact, 'R5').detail).toContain('unverified')
  })

  it('passes when the live stamp is the expected commit', async () => {
    const artefact = await run(writeAdoptionBaseline, {
      expectSha: SHA,
      headerProbe: fakeHeaderProbe,
      liveReality: fakeLive({ 'x-build-version': '48ba389bdb1b' }),
      liveUrl: 'https://buoystat.us',
    })

    expect(artefact.live?.matched).toBe(true)
    expect(req(artefact, 'R5').verdict).toBe('pass')
  })

  it('fails when the live stamp is some other commit', async () => {
    const artefact = await run(writeAdoptionBaseline, {
      expectSha: SHA,
      headerProbe: fakeHeaderProbe,
      liveReality: fakeLive({ 'x-build-version': '0743e5117d69' }),
      liveUrl: 'https://buoystat.us',
    })

    expect(artefact.live?.matched).toBe(false)
    expect(req(artefact, 'R5').verdict).toBe('fail')
    expect(artefact.result).toBe('FAIL')
  })

  it('an origin that serves no build stamp is unknown, not a pass', async () => {
    const artefact = await run(writeAdoptionBaseline, {
      expectSha: SHA,
      headerProbe: fakeHeaderProbe,
      liveReality: fakeLive({}),
      liveUrl: 'https://buoystat.us',
    })

    expect(artefact.live?.buildVersion).toBeNull()
    expect(req(artefact, 'R5').verdict).toBe('unknown')
  })

  it('fails requirement 8 from the probe it was given, not from the network', async () => {
    // Doubles as the proof that the probe seam is wired: a report-only policy
    // is served nowhere in production, so a fail here can only have come from
    // the injected probe.
    const reportOnly = { ...CONFORMANT_HEADERS }
    delete reportOnly['content-security-policy']
    reportOnly['content-security-policy-report-only'] =
      CONFORMANT_HEADERS['content-security-policy']

    const artefact = await run(writeAdoptionBaseline, {
      headerProbe: async (url) => ({ headers: reportOnly, status: 200, url }),
      liveReality: fakeLive({ 'x-build-version': '48ba389bdb1b' }),
      liveUrl: 'https://buoystat.us',
    })

    expect(req(artefact, 'R8').verdict).toBe('fail')
    expect(artefact.result).toBe('FAIL')
  })

  it('reads the health route and reports what it answered', async () => {
    const healthy = await run(writeAdoptionBaseline, {
      headerProbe: fakeHeaderProbe,
      liveReality: fakeLive({ 'x-build-version': '48ba389bdb1b' }),
      liveUrl: 'https://buoystat.us',
    })
    const sick = await run(writeAdoptionBaseline, {
      headerProbe: fakeHeaderProbe,
      liveReality: fakeLive({ 'x-build-version': '48ba389bdb1b' }, 503),
      liveUrl: 'https://buoystat.us',
    })

    expect(req(healthy, 'R12').verdict).toBe('pass')
    expect(req(sick, 'R12').verdict).toBe('fail')
    // Even a healthy route only decides that the route answered. Whether the
    // counts it reports match the data served is the app's own contract tests.
    expect(req(healthy, 'R12').enforcement).toBe('partially-enforced')
  })
})

describe('commit stamp matching', () => {
  it('matches an abbreviated stamp against the full commit', () => {
    expect(matchesCommit(SHA, '48ba389bdb1b')).toBe(true)
    expect(matchesCommit(SHA, SHA)).toBe(true)
  })

  it('refuses a stamp too short to identify anything', () => {
    // A one-character header prefixes roughly one commit in sixteen. A proof
    // that a degenerate header could satisfy is not a proof.
    expect(matchesCommit(SHA, '4')).toBe(false)
    expect(matchesCommit(SHA, '48ba38')).toBe(false)
  })

  it('refuses a different commit', () => {
    expect(matchesCommit(SHA, '0743e5117d69')).toBe(false)
  })

  it('ignores case and surrounding whitespace', () => {
    expect(matchesCommit(SHA, ' 48BA389BDB1B\n')).toBe(true)
  })
})

describe('requirements that stay honest about what they proved', () => {
  it('does not claim a working map from a dependency line', async () => {
    const artefact = await run(
      (root) => {
        writeAdoptionBaseline(root)
        writeJson(root, 'apps/web/package.json', {
          dependencies: { '@narduk-enterprises/narduk-mapkit': '2.7.0' },
        })
      },
      { reality: baselineReality({ '@narduk-enterprises/narduk-mapkit': '2.7.0' }) },
    )

    const mapkit = req(artefact, 'R9')
    expect(mapkit.verdict).toBe('pass')
    // Provenance passed. "Maps function with the actual SDK" did not, and the
    // report says which of the two it decided.
    expect(mapkit.enforcement).toBe('partially-enforced')
    expect(mapkit.detail).toContain('real-SDK')
    expect(artefact.mapkit.functional).toBe('evidence-required')
  })

  it('reports requirement 9 as not-applicable for an app that draws no maps', async () => {
    const artefact = await run()

    expect(req(artefact, 'R9').verdict).toBe('not-applicable')
    expect(artefact.score.notApplicable).toBeGreaterThan(0)
  })

  it('calls the reimplementation scan partially enforced, because it is a signal scan', async () => {
    const artefact = await run()

    expect(req(artefact, 'R10').enforcement).toBe('partially-enforced')
  })

  it('counts every verdict exactly once', async () => {
    const artefact = await run()
    const { pass, fail, unknown, notApplicable, deviation } = artefact.score

    expect(pass + fail + unknown + notApplicable + deviation).toBe(ADOPTION_REQUIREMENT_COUNT)
  })
})

describe('the doctor --adoption flags', () => {
  it('reads the checkout, the origin, the commit and the probe paths', () => {
    const flags = parseAdoptionReportArgs(
      [
        '--adoption',
        '--checkout',
        '/repo',
        '--live',
        'https://buoystat.us',
        '--expect-sha',
        SHA,
        '--path',
        '/stations',
        '--path',
        '/data-attribution',
      ],
      '/cwd',
    )

    expect(flags.checkoutDir).toBe('/repo')
    expect(flags.liveUrl).toBe('https://buoystat.us')
    expect(flags.expectSha).toBe(SHA)
    expect(flags.paths).toEqual(['/stations', '/data-attribution'])
  })

  it('refuses an expected commit with no origin to compare it against', () => {
    // Otherwise the flag reads as if it proved something, and the report comes
    // back with R5 undecided and no explanation of why the flag did nothing.
    expect(() => parseAdoptionReportArgs(['--adoption', '--expect-sha', SHA], '/cwd')).toThrow(
      /--expect-sha needs --live/,
    )
  })

  it('refuses an unknown option instead of ignoring it', () => {
    expect(() => parseAdoptionReportArgs(['--adoption', '--nope'], '/cwd')).toThrow(/--nope/)
  })

  it('defaults to the working directory and no live reading', () => {
    const flags = parseAdoptionReportArgs(['--adoption'], '/cwd')

    expect(flags.checkoutDir).toBe('/cwd')
    expect(flags.liveUrl).toBeNull()
    expect(flags.paths).toEqual([])
  })

  it('leaves bare doctor alone', () => {
    // The existing report has callers. `--adoption` replaces it; it does not
    // reshape what they already parse.
    const root = makeTempRepo()
    tempDirs.push(root)
    const report = runDoctor(root)

    expect(report).toHaveProperty('checks')
    expect(report).toHaveProperty('clean')
    expect(report).not.toHaveProperty('requirements')
  })
})
