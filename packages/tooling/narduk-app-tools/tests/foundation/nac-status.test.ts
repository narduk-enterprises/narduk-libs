import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  formatAdoptionSummary,
  runAdoptionCheck,
  type AdoptionArtefact,
} from '../../src/foundation/evaluate-adoption.js'
import {
  FRESHNESS_MAX_AGE_DAYS,
  NAC_CHECKS,
  NAC_CHECK_IDS,
  NAC_UNSCORED_REQUIREMENTS,
  UNWAIVABLE_CHECKS,
  buildNacStatus,
  createGithubDependabotReality,
  judgeWaivers,
  summariseDependabot,
  type DependabotReality,
  type NacCheck,
  type NacCheckId,
  type NacMeasured,
  type RequirementLike,
} from '../../src/foundation/evaluate-nac-status.js'
import type { RegistryReality } from '../../src/foundation/npm-registry.js'
import {
  BASELINE_PINS,
  NO_ALERTS,
  SHA,
  TOOL_VERSION,
  baselineReality,
  fakeHeaderProbe,
  fakeLive,
  writeAdoptionBaseline,
} from './adoption-fixture.js'
import { fakeReality, makeTempRepo, writeJson } from './helpers.js'

const GENERATED = '2026-10-04T12:00:00.000Z'
const STAMP = SHA.slice(0, 12)

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

interface RunOptions {
  /** Entries for `waivers` in Config/cloudflare-app.json; omitted = no key. */
  waivers?: unknown
  live?: boolean
  stamp?: string
  health?: number
  reality?: RegistryReality
  dependabot?: DependabotReality
}

/** A fixture app, with a live origin by default, run end to end. */
async function run(options: RunOptions = {}): Promise<AdoptionArtefact> {
  const root = makeTempRepo()
  tempDirs.push(root)
  writeAdoptionBaseline(root)
  if (options.waivers !== undefined) {
    const path = join(root, 'Config', 'cloudflare-app.json')
    const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    writeJson(root, 'Config/cloudflare-app.json', { ...config, waivers: options.waivers })
  }
  const live = options.live ?? true
  return runAdoptionCheck({
    dependabotReality: options.dependabot ?? NO_ALERTS,
    expectSha: live ? SHA : undefined,
    generated: GENERATED,
    headerProbe: fakeHeaderProbe,
    liveReality: live
      ? fakeLive({ 'x-build-version': options.stamp ?? STAMP }, options.health)
      : undefined,
    liveUrl: live ? 'https://fixture.test' : undefined,
    reality: options.reality ?? baselineReality(),
    root,
    toolVersion: TOOL_VERSION,
  })
}

function check(artefact: AdoptionArtefact, id: NacCheckId): NacCheck {
  const found = artefact.checks.find((entry) => entry.id === id)
  if (!found) throw new Error(`no ${id} check in the report`)
  return found
}

/** The estate has published a newer core than the app pins. */
function behindReality(): RegistryReality {
  const installed: Record<string, { version: string; major: number; source: 'manifest-pin' }> = {}
  const publications: Record<string, { status: 'published'; latest: string; major: number }> = {}
  for (const [name, version] of Object.entries(BASELINE_PINS)) {
    const major = Number(version.split('.')[0])
    installed[name] = { major, source: 'manifest-pin', version }
    publications[name] = {
      latest: name === '@narduk-enterprises/narduk-core' ? '3.5.0' : version,
      major,
      status: 'published',
    }
  }
  return fakeReality({ installed, publications })
}

const alerts = (...rows: Array<[string, string | null]>): DependabotReality => ({
  read: async () => ({
    alerts: rows.map(([severity, firstPatchedVersion]) => ({
      firstPatchedVersion,
      packageName: 'left-pad',
      severity,
    })),
    kind: 'read',
  }),
})

describe('the six checks', () => {
  it('emits platform, delivery, security, health, packages and freshness, in that order', async () => {
    const artefact = await run()

    expect(artefact.checks.map((entry) => entry.id)).toEqual([...NAC_CHECK_IDS])
    expect(artefact.checks.map((entry) => entry.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(artefact.checks.map((entry) => entry.group)).toEqual([
      'structural',
      'structural',
      'structural',
      'structural',
      'currency',
      'currency',
    ])
  })

  it('reads Narduk app, up to date, for a conformant app that is live and current', async () => {
    const artefact = await run()

    expect(artefact.checks.map((entry) => `${entry.id}:${entry.verdict}`)).toEqual([
      'platform:pass',
      'delivery:pass',
      'security:pass',
      'health:pass',
      'packages:pass',
      'freshness:pass',
    ])
    expect(artefact.status).toBe('narduk-app')
    expect(artefact.upToDate).toBe(true)
    expect(artefact.blocking).toEqual([])
  })

  it('maps every check to a diagnostic, and every requirement to one check or to none on purpose', () => {
    for (const definition of NAC_CHECKS) {
      expect(definition.diagnostics.length, `${definition.id} names no diagnostic`).toBeGreaterThan(
        0,
      )
    }
    expect(NAC_CHECKS.map((definition) => definition.id)).toEqual([...NAC_CHECK_IDS])

    const owners = new Map<string, string[]>()
    for (const definition of NAC_CHECKS) {
      for (const id of definition.from) owners.set(id, [...(owners.get(id) ?? []), definition.id])
    }
    for (let n = 1; n <= 15; n += 1) {
      const id = `R${n}`
      const scored = owners.get(id) ?? []
      if (NAC_UNSCORED_REQUIREMENTS.includes(id)) {
        expect(scored, `${id} is unscored and must feed no check`).toEqual([])
      } else {
        expect(scored, `${id} must feed exactly one check`).toHaveLength(1)
      }
    }
    expect([...NAC_UNSCORED_REQUIREMENTS].sort()).toEqual(['R11', 'R13', 'R14'])
  })

  it("carries each check's diagnostics, source requirements and evidence in the artefact", async () => {
    const artefact = await run()

    expect(check(artefact, 'delivery').from).toEqual(['R1', 'R5', 'R6', 'R7'])
    expect(check(artefact, 'platform').from).toEqual(['R4', 'R10'])
    expect(check(artefact, 'delivery').diagnostics.join(' ')).toContain('deployment')
    expect(check(artefact, 'security').diagnostics.join(' ')).toContain('dependabot')
  })

  it('stays additive: schema 1 and the R1-R15 requirements are where they were', async () => {
    const artefact = await run()
    const roundTripped = JSON.parse(JSON.stringify(artefact)) as Record<string, unknown>

    expect(roundTripped.schemaVersion).toBe(1)
    expect(roundTripped.statusSchemaVersion).toBe(1)
    expect((roundTripped.requirements as unknown[]).length).toBe(15)
    expect(roundTripped).toHaveProperty('score')
    expect(roundTripped).toHaveProperty('result')
    expect(roundTripped).toHaveProperty('manualReview')
    expect(roundTripped).toHaveProperty('status', 'narduk-app')
    expect(roundTripped).toHaveProperty('upToDate', true)
    expect(artefact.standard).toMatchObject({ checks: 6, decision: 'D-NAC-STATUS-1' })
  })
})

describe('what each check rolls up', () => {
  it('without --live, delivery, security and health are unknown with a reason, never a pass', async () => {
    const artefact = await run({ live: false })

    for (const id of ['delivery', 'security', 'health'] as const) {
      expect(check(artefact, id).verdict, id).toBe('unknown')
      expect(check(artefact, id).reason, id).toBeTruthy()
    }
    expect(artefact.status).toBe('not-yet')
    expect(artefact.blocking).toEqual(['delivery', 'security', 'health'])
  })

  it('delivery fails when the live origin serves another commit', async () => {
    const artefact = await run({ stamp: '0743e5117d69' })

    expect(check(artefact, 'delivery').verdict).toBe('fail')
    expect(check(artefact, 'delivery').detail).toContain('R5')
    expect(artefact.status).toBe('not-yet')
    expect(artefact.blocking).toEqual(['delivery'])
  })

  it('health fails when the health route answers 503', async () => {
    const artefact = await run({ health: 503 })

    expect(check(artefact, 'health').verdict).toBe('fail')
    expect(check(artefact, 'health').detail).toContain('503')
    expect(artefact.blocking).toEqual(['health'])
  })

  it('packages fails when an estate package is behind the newest release', async () => {
    const artefact = await run({ reality: behindReality() })

    expect(check(artefact, 'packages').verdict).toBe('fail')
    expect(check(artefact, 'packages').detail).toContain('narduk-core')
    // Behind is not "not a Narduk app": the structural four still pass.
    expect(artefact.status).toBe('narduk-app')
    expect(artefact.upToDate).toBe(false)
  })

  it('packages is unknown, not a pass, when the registry cannot be read', async () => {
    const artefact = await run({ reality: fakeReality() })

    expect(check(artefact, 'packages').measured).not.toBe('pass')
    expect(artefact.upToDate).toBe(false)
  })

  it('freshness names the generating checker and the 14-day bound', async () => {
    const artefact = await run()

    expect(artefact.freshness).toEqual({
      freshUntil: '2026-10-18T12:00:00.000Z',
      generated: GENERATED,
      maxAgeDays: FRESHNESS_MAX_AGE_DAYS,
      toolVersion: TOOL_VERSION,
    })
    expect(FRESHNESS_MAX_AGE_DAYS).toBe(14)
    expect(check(artefact, 'freshness').detail).toContain(TOOL_VERSION)
  })
})

describe('rolling requirement verdicts into a check', () => {
  const req = (id: string, verdict: RequirementLike['verdict'], detail = id): RequirementLike => ({
    detail,
    evidence: [],
    id,
    verdict,
  })
  const build = (requirements: RequirementLike[]) =>
    buildNacStatus({
      dependabot: summariseDependabot({ alerts: [], kind: 'read' }),
      generated: GENERATED,
      requirements,
      toolVersion: TOOL_VERSION,
      waiverEntries: [],
    })
  const delivery = (requirements: RequirementLike[]) =>
    build(requirements).checks.find((entry) => entry.id === 'delivery')!

  it('fail beats unknown beats pass', () => {
    expect(delivery([req('R1', 'pass'), req('R5', 'unknown'), req('R6', 'fail')]).measured).toBe(
      'fail',
    )
    expect(delivery([req('R1', 'pass'), req('R5', 'unknown')]).measured).toBe('unknown')
    expect(delivery([req('R1', 'pass'), req('R5', 'pass')]).measured).toBe('pass')
  })

  it('ignores a requirement that does not apply, and passes when none does', () => {
    expect(
      delivery([req('R1', 'pass'), req('R5', 'pass'), req('R6', 'not-applicable')]).measured,
    ).toBe('pass')
    expect(delivery([req('R6', 'not-applicable'), req('R7', 'not-applicable')]).measured).toBe(
      'pass',
    )
  })

  it('reads a declared deviation from the standard as a failure of the check', () => {
    expect(delivery([req('R1', 'deviation'), req('R5', 'pass')]).measured).toBe('fail')
  })

  it('never lets an unscored requirement move a check', () => {
    const noisy = [
      req('R4', 'pass'),
      req('R10', 'pass'),
      req('R11', 'fail'),
      req('R13', 'fail'),
      req('R14', 'unknown'),
    ]
    expect(build(noisy).checks.find((entry) => entry.id === 'platform')!.measured).toBe('pass')
  })
})

describe('the Dependabot read behind security (D-NAC-STATUS-1: unknown, never pass or fail, when unreadable)', () => {
  it('passes when no fixable high or critical alert is open', async () => {
    const artefact = await run({ dependabot: alerts() })

    expect(check(artefact, 'security').verdict).toBe('pass')
    expect(artefact.dependabot).toMatchObject({ fixableCritical: 0, fixableHigh: 0, read: 'ok' })
  })

  it('fails on a fixable high or critical alert, and says how many of each', async () => {
    const artefact = await run({
      dependabot: alerts(['high', '1.2.3'], ['critical', '4.0.0'], ['high', '2.0.0']),
    })

    expect(check(artefact, 'security').verdict).toBe('fail')
    expect(check(artefact, 'security').detail).toContain('3 open alert(s)')
    expect(check(artefact, 'security').detail).toContain('1 critical, 2 high')
    expect(artefact.blocking).toEqual(['security'])
    expect(artefact.status).toBe('not-yet')
  })

  it('does not count an alert with no patched release, nor a medium one', async () => {
    const artefact = await run({ dependabot: alerts(['high', null], ['medium', '1.0.1']) })

    expect(check(artefact, 'security').verdict).toBe('pass')
    expect(artefact.dependabot.fixableHigh).toBe(0)
  })

  it('answers unknown, with the reason, when the token cannot read alerts', async () => {
    const artefact = await run({
      dependabot: {
        read: async () => ({
          kind: 'unknown',
          reason: 'GitHub answered 403 (Resource not accessible by integration)',
        }),
      },
    })

    const security = check(artefact, 'security')
    expect(security.verdict).toBe('unknown')
    expect(security.measured).toBe('unknown')
    expect(security.reason).toContain('403')
    expect(artefact.dependabot).toMatchObject({ fixableCritical: null, read: 'unknown' })
    expect(artefact.status).toBe('not-yet')
    expect(artefact.blocking).toEqual(['security'])
  })

  it('an unreadable alert list keeps security unknown even though the headers pass', async () => {
    const artefact = await run({
      dependabot: { read: async () => ({ kind: 'unknown', reason: 'no token' }) },
    })

    expect(artefact.requirements.find((entry) => entry.id === 'R8')?.verdict).toBe('pass')
    expect(check(artefact, 'security').verdict).toBe('unknown')
  })
})

describe('the GitHub Dependabot reader', () => {
  const response = (status: number, body: unknown, link?: string): Response =>
    new Response(JSON.stringify(body), { status, headers: link ? { link } : {} })

  it('is unknown with the missing permission named when there is no token', async () => {
    const saved = { gh: process.env.GH_TOKEN, github: process.env.GITHUB_TOKEN }
    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
    try {
      const read = await createGithubDependabotReality().read('narduk-enterprises/x')
      expect(read).toMatchObject({ kind: 'unknown' })
      expect(JSON.stringify(read)).toContain('Dependabot alerts: read')
    } finally {
      if (saved.gh !== undefined) process.env.GH_TOKEN = saved.gh
      if (saved.github !== undefined) process.env.GITHUB_TOKEN = saved.github
    }
  })

  it('is unknown when GitHub refuses the read, naming the permission and never the token', async () => {
    const secret = 'ghs_THIS_MUST_NOT_APPEAR'
    const reality = createGithubDependabotReality({
      fetchImpl: async () => response(403, { message: 'Resource not accessible by integration' }),
      token: secret,
    })
    const read = await reality.read('narduk-enterprises/x')

    expect(read.kind).toBe('unknown')
    const text = JSON.stringify(read)
    expect(text).toContain('403')
    expect(text).toContain('Resource not accessible by integration')
    expect(text).toContain('Dependabot alerts: read')
    expect(text).not.toContain(secret)
  })

  it('is unknown when the app repository is not known', async () => {
    const read = await createGithubDependabotReality({ token: 't' }).read('unknown/unknown')
    expect(read.kind).toBe('unknown')
  })

  it('is unknown when the network fails', async () => {
    const reality = createGithubDependabotReality({
      fetchImpl: async () => {
        throw new Error('getaddrinfo ENOTFOUND api.github.com')
      },
      token: 't',
    })
    expect(await reality.read('narduk-enterprises/x')).toMatchObject({ kind: 'unknown' })
  })

  it('reads open critical and high alerts, with the patched version, from the REST list', async () => {
    const urls: string[] = []
    const reality = createGithubDependabotReality({
      fetchImpl: async (url) => {
        urls.push(String(url))
        return response(200, [
          {
            security_advisory: { severity: 'high' },
            security_vulnerability: {
              first_patched_version: { identifier: '2.0.1' },
              package: { name: 'axios' },
              severity: 'high',
            },
          },
          {
            security_advisory: { severity: 'critical' },
            security_vulnerability: { first_patched_version: null, package: { name: 'old' } },
          },
        ])
      },
      token: 't',
    })
    const read = await reality.read('narduk-enterprises/x')

    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('/repos/narduk-enterprises/x/dependabot/alerts')
    expect(urls[0]).toContain('state=open')
    expect(urls[0]).toContain('severity=critical,high')
    expect(read).toEqual({
      alerts: [
        { firstPatchedVersion: '2.0.1', packageName: 'axios', severity: 'high' },
        { firstPatchedVersion: null, packageName: 'old', severity: 'critical' },
      ],
      kind: 'read',
    })
    expect(summariseDependabot(read)).toMatchObject({ fixableCritical: 0, fixableHigh: 1 })
  })

  it('uses cursor links, including a fixable alert after a short first page', async () => {
    const urls: string[] = []
    const row = {
      security_vulnerability: { first_patched_version: { identifier: '1' }, severity: 'high' },
    }
    const reality = createGithubDependabotReality({
      fetchImpl: async (url) => {
        urls.push(String(url))
        if (new URL(String(url)).searchParams.has('page')) {
          return response(400, {
            message: 'Pagination using the `page` parameter is not supported.',
          })
        }
        return urls.length === 1
          ? response(
              200,
              [],
              '<https://api.github.com/repos/narduk-enterprises/x/dependabot/alerts?after=opaque%2Bcursor>; rel="next"',
            )
          : response(200, [row])
      },
      token: 't',
    })
    const read = await reality.read('narduk-enterprises/x')

    expect(urls).toHaveLength(2)
    expect(new URL(urls[1]!).searchParams.get('after')).toBe('opaque+cursor')
    for (const url of urls) {
      expect(new URL(url).searchParams.has('page')).toBe(false)
      expect(new URL(url).searchParams.get('state')).toBe('open')
      expect(new URL(url).searchParams.get('severity')).toBe('critical,high')
      expect(new URL(url).searchParams.get('per_page')).toBe('100')
    }
    expect(summariseDependabot(read)).toMatchObject({ read: 'ok', fixableHigh: 1 })
  })

  it('accepts a full terminal page without inventing a next request', async () => {
    let calls = 0
    const reality = createGithubDependabotReality({
      fetchImpl: async () => {
        calls += 1
        return response(
          200,
          Array.from({ length: 100 }, () => ({ security_advisory: { severity: 'high' } })),
        )
      },
      token: 't',
    })
    const read = await reality.read('narduk-enterprises/x')
    expect(calls).toBe(1)
    expect(read.kind === 'read' && read.alerts.length).toBe(100)
  })

  it('supports the Link before cursor on the configured API origin', async () => {
    const urls: string[] = []
    const reality = createGithubDependabotReality({
      apiUrl: 'https://github.example/api/v3',
      token: 't',
      fetchImpl: async (url) => {
        urls.push(String(url))
        return response(
          200,
          [],
          urls.length === 1
            ? '<https://github.example/api/v3/repos/narduk-enterprises/x/dependabot/alerts?before=cursor>; rel="next"'
            : undefined,
        )
      },
    })
    expect(await reality.read('narduk-enterprises/x')).toMatchObject({ kind: 'read' })
    expect(new URL(urls[1]!).searchParams.get('before')).toBe('cursor')
  })

  it.each([
    '<https://foreign.example/repos/narduk-enterprises/x/dependabot/alerts?after=c>; rel="next"',
    '<https://api.github.com/repos/other/repo/dependabot/alerts?after=c>; rel="next"',
    '<https://user:secret@api.github.com/repos/narduk-enterprises/x/dependabot/alerts?after=c>; rel="next"',
    '<https://api.github.com/repos/narduk-enterprises/x/dependabot/alerts?page=2>; rel="next"',
    '<https://api.github.com/repos/narduk-enterprises/x/dependabot/alerts?after=c&before=d>; rel="next"',
    '<https://api.github.com/repos/narduk-enterprises/x/dependabot/alerts?after=>; rel="next"',
    '<https://api.github.com/repos/narduk-enterprises/x/dependabot/alerts?after=c>; rel="next", <https://api.github.com/repos/narduk-enterprises/x/dependabot/alerts?after=d>; rel="next"',
    '<https://api.github.com/prev>; rel="prev", broken; rel="next"',
  ])('refuses invalid continuation without forwarding the token: %s', async (link) => {
    let calls = 0
    const token = 'ghs_NEVER_RETURN_THIS'
    const reality = createGithubDependabotReality({
      token,
      fetchImpl: async () => {
        calls += 1
        return response(200, [], link)
      },
    })
    const read = await reality.read('narduk-enterprises/x')
    expect(read.kind).toBe('unknown')
    expect(calls).toBe(1)
    expect(JSON.stringify(read)).not.toContain(token)
    expect(JSON.stringify(read)).not.toContain('user:secret')
  })

  it('is unknown if a later page is denied; partial results cannot pass', async () => {
    let calls = 0
    const reality = createGithubDependabotReality({
      token: 't',
      fetchImpl: async () => {
        calls += 1
        return calls === 1
          ? response(
              200,
              [],
              '<https://api.github.com/repos/narduk-enterprises/x/dependabot/alerts?after=c>; rel="next"',
            )
          : response(403, { message: 'Resource not accessible by integration' })
      },
    })
    expect(summariseDependabot(await reality.read('narduk-enterprises/x'))).toMatchObject({
      read: 'unknown',
      fixableHigh: null,
      fixableCritical: null,
    })
  })

  it('stops a repeated cursor without returning a partial clean bill', async () => {
    let calls = 0
    const reality = createGithubDependabotReality({
      token: 't',
      fetchImpl: async () => {
        calls += 1
        return response(
          200,
          [],
          '<https://api.github.com/repos/narduk-enterprises/x/dependabot/alerts?after=c>; rel="next"',
        )
      },
    })
    expect(await reality.read('narduk-enterprises/x')).toMatchObject({
      kind: 'unknown',
      reason: expect.stringContaining('repeated'),
    })
    expect(calls).toBe(2)
  })

  it('retains the ten-page ceiling and is unknown if pagination has not ended', async () => {
    let calls = 0
    const reality = createGithubDependabotReality({
      token: 't',
      fetchImpl: async () => {
        calls += 1
        return response(
          200,
          [],
          `<https://api.github.com/repos/narduk-enterprises/x/dependabot/alerts?after=${calls}>; rel="next"`,
        )
      },
    })
    expect(await reality.read('narduk-enterprises/x')).toMatchObject({
      kind: 'unknown',
      reason: expect.stringContaining('10 pages'),
    })
    expect(calls).toBe(10)
  })

  it('does not misdiagnose a bad request as a missing permission', async () => {
    const reality = createGithubDependabotReality({
      token: 't',
      fetchImpl: async () =>
        response(400, { message: 'Pagination using the `page` parameter is not supported.' }),
    })
    const read = await reality.read('narduk-enterprises/x')
    expect(read.kind).toBe('unknown')
    expect(JSON.stringify(read)).toContain('400')
    expect(JSON.stringify(read)).not.toContain('vulnerability-alerts')
    expect(JSON.stringify(read)).not.toContain('checker does not widen')
  })

  it('refuses an oversized page instead of returning an unbounded clean bill', async () => {
    const reality = createGithubDependabotReality({
      token: 't',
      fetchImpl: async () =>
        response(
          200,
          Array.from({ length: 101 }, () => ({})),
        ),
    })
    expect(await reality.read('narduk-enterprises/x')).toMatchObject({
      kind: 'unknown',
      reason: expect.stringContaining('page-size bound'),
    })
  })
})

describe('waivers (a check, an issue and an expiry, in Config/cloudflare-app.json)', () => {
  const waiver = (check: string, expires: string, issue: unknown = '#1409') => ({
    check,
    expires,
    issue,
  })

  it('reports a waived failing check as waived until the expiry, and counts it as passing', async () => {
    const artefact = await run({
      reality: behindReality(),
      waivers: [waiver('packages', '2026-10-31', '#1500')],
    })
    const packages = check(artefact, 'packages')

    expect(packages.verdict).toBe('waived')
    expect(packages.measured).toBe('fail')
    expect(packages.waiver).toEqual({ expires: '2026-10-31', issue: '#1500' })
    expect(artefact.upToDate).toBe(true)
    expect(artefact.waivers).toEqual([
      expect.objectContaining({ check: 'packages', issue: '#1500', state: 'active' }),
    ])
    expect(formatAdoptionSummary(artefact)).toContain('until 2026-10-31 (#1500)')
  })

  it('also waives an unknown check: health, when the origin cannot be read', async () => {
    const artefact = await run({ live: false, waivers: [waiver('health', '2026-10-31')] })

    expect(check(artefact, 'health').verdict).toBe('waived')
    expect(check(artefact, 'health').measured).toBe('unknown')
  })

  it('still counts on the day of the expiry', async () => {
    const artefact = await run({
      reality: behindReality(),
      waivers: [waiver('packages', '2026-10-04')],
    })
    expect(check(artefact, 'packages').verdict).toBe('waived')
  })

  it('reads the real verdict the day after the expiry: a waiver past its expires is FAIL', async () => {
    const artefact = await run({
      reality: behindReality(),
      waivers: [waiver('packages', '2026-10-03')],
    })
    const packages = check(artefact, 'packages')

    expect(packages.verdict).toBe('fail')
    expect(packages.waiver).toBeNull()
    expect(artefact.upToDate).toBe(false)
    expect(artefact.waivers[0]).toMatchObject({
      reason: expect.stringContaining('expired'),
      state: 'expired',
    })
  })

  it.each(['delivery', 'security'] as const)(
    'refuses a waiver on %s: the check keeps its real verdict and the refusal is reported',
    async (id) => {
      const artefact = await run({
        dependabot: alerts(['critical', '9.9.9']),
        stamp: '0743e5117d69',
        waivers: [waiver(id, '2099-01-01')],
      })

      expect(check(artefact, id).verdict).toBe('fail')
      expect(check(artefact, id).waiver).toBeNull()
      expect(check(artefact, id).detail).toContain('a waiver for this check was refused')
      expect(artefact.waivers).toEqual([expect.objectContaining({ check: id, state: 'refused' })])
      expect(artefact.status).toBe('not-yet')
      expect(artefact.blocking).toContain(id)
    },
  )

  it('refuses delivery and security even when they are only unknown', async () => {
    const artefact = await run({
      live: false,
      waivers: [waiver('delivery', '2099-01-01'), waiver('security', '2099-01-01')],
    })

    expect(check(artefact, 'delivery').verdict).toBe('unknown')
    expect(check(artefact, 'security').verdict).toBe('unknown')
    expect(artefact.waivers.map((entry) => entry.state)).toEqual(['refused', 'refused'])
  })

  it('the unwaivable set is exactly delivery and security', () => {
    expect([...UNWAIVABLE_CHECKS].sort()).toEqual(['delivery', 'security'])
  })

  it('leaves a passing check passing: a waiver it does not need is not a downgrade', async () => {
    const artefact = await run({ waivers: [waiver('platform', '2026-10-31')] })

    expect(check(artefact, 'platform').verdict).toBe('pass')
    expect(check(artefact, 'platform').waiver).toBeNull()
    expect(artefact.waivers[0]).toMatchObject({ state: 'unneeded' })
  })

  it('applies the waiver that runs longest when a check carries two', async () => {
    const artefact = await run({
      reality: behindReality(),
      waivers: [waiver('packages', '2026-10-10', '#1'), waiver('packages', '2026-12-01', '#2')],
    })

    expect(check(artefact, 'packages').waiver).toEqual({ expires: '2026-12-01', issue: '#2' })
  })

  it("keeps a waived app's other failures: a waiver covers one check only", async () => {
    const artefact = await run({
      health: 503,
      reality: behindReality(),
      waivers: [waiver('packages', '2026-10-31')],
    })

    expect(check(artefact, 'packages').verdict).toBe('waived')
    expect(check(artefact, 'health').verdict).toBe('fail')
    expect(artefact.status).toBe('not-yet')
  })

  it('a waived structural check counts toward Narduk app', async () => {
    const artefact = await run({ health: 503, waivers: [waiver('health', '2026-10-31')] })

    expect(check(artefact, 'health').verdict).toBe('waived')
    expect(artefact.status).toBe('narduk-app')
    expect(artefact.blocking).toEqual([])
  })

  it('does not break the other checks that read the same config file', async () => {
    const artefact = await run({ waivers: [waiver('packages', '2026-10-31')] })

    expect(check(artefact, 'delivery').verdict).toBe('pass')
    expect(check(artefact, 'platform').verdict).toBe('pass')
  })

  describe('malformed entries are reported, never applied', () => {
    const cases: Array<[string, unknown, RegExp]> = [
      ['an unknown check name', waiver('uptime', '2026-10-31'), /one of platform/u],
      ['no issue', { check: 'packages', expires: '2026-10-31' }, /issue/u],
      ['a prose issue', waiver('packages', '2026-10-31', 'see the thread'), /issue/u],
      ['a bad date', waiver('packages', '10/31/2026'), /YYYY-MM-DD/u],
      ['an impossible date', waiver('packages', '2026-02-31'), /real date/u],
      ['a non-object', 'packages', /check/u],
    ]
    it.each(cases)('%s', async (_name, entry, reason) => {
      const artefact = await run({ reality: behindReality(), waivers: [entry] })

      expect(artefact.waivers).toHaveLength(1)
      expect(artefact.waivers[0]).toMatchObject({
        state: 'invalid',
        reason: expect.stringMatching(reason),
      })
      expect(check(artefact, 'packages').verdict).toBe('fail')
    })

    it('a waivers value that is not an array is one invalid entry, not "no waivers"', async () => {
      const artefact = await run({ reality: behindReality(), waivers: { check: 'packages' } })

      expect(artefact.waivers).toEqual([expect.objectContaining({ state: 'invalid' })])
      expect(check(artefact, 'packages').verdict).toBe('fail')
    })
  })

  it('normalises an issue written as a number or an issue URL', () => {
    const measured = Object.fromEntries(NAC_CHECK_IDS.map((id) => [id, 'fail'])) as Record<
      NacCheckId,
      NacMeasured
    >
    const [numeric, url, cross] = judgeWaivers(
      [
        waiver('packages', '2026-12-01', 1409),
        waiver(
          'health',
          '2026-12-01',
          'https://github.com/narduk-enterprises/narduk-libs/issues/1409',
        ),
        waiver('platform', '2026-12-01', 'narduk-enterprises/narduk-libs#1409'),
      ],
      measured,
      GENERATED,
    )
    expect([numeric.issue, numeric.state]).toEqual(['#1409', 'active'])
    expect(url.state).toBe('active')
    expect(cross.state).toBe('active')
  })

  it('an app with no config file at all has no waivers', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    const artefact = await runAdoptionCheck({
      dependabotReality: NO_ALERTS,
      generated: GENERATED,
      reality: baselineReality(),
      root,
      toolVersion: TOOL_VERSION,
    })
    expect(artefact.waivers).toEqual([])
  })
})

describe('the summary', () => {
  it('leads with the status line and the six checks, and keeps the legacy list below', async () => {
    const text = formatAdoptionSummary(await run({ health: 503 }))

    expect(text).toContain('status     Not yet (health)')
    expect(text).toMatch(/\[FAIL {2}\] 4 Healthy/u)
    expect(text).toContain('Legacy requirements R1-R15')
    expect(text.indexOf('status     ')).toBeLessThan(text.indexOf('R1 '))
  })

  it('says behind when the structural four pass and the packages do not', async () => {
    const text = formatAdoptionSummary(await run({ reality: behindReality() }))
    expect(text).toContain('status     Narduk app · behind')
  })

  it('says up to date when all six pass', async () => {
    expect(formatAdoptionSummary(await run())).toContain('status     Narduk app · up to date')
  })
})
