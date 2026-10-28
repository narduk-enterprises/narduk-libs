import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runAdoptionCheck, type AdoptionArtefact } from '../../src/foundation/evaluate-adoption.js'
import {
  FOUNDATION_EXCEPTION_TOKEN_ENV,
  createPortalFoundationExceptionReality,
  type FoundationExceptionReality,
  type FoundationExceptionRow,
} from '../../src/foundation/foundation-exception.js'
import {
  BASELINE_PINS,
  NODE,
  NO_ALERTS,
  PNPM,
  TOOL_VERSION,
  baselineReality,
  writeAdoptionBaseline,
} from './adoption-fixture.js'
import { makeTempRepo, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const REPO = 'narduk-enterprises-clients/pacc-trac'
const GENERATED = '2026-10-28T12:00:00.000Z'

const ROW: FoundationExceptionRow = {
  decision: 'D-FOCUS-1',
  expiresOn: '2027-03-29',
  issue: 'https://example.test/issues/1',
  items: [2, 3],
  repos: [],
}

function holding(row: FoundationExceptionRow | null): FoundationExceptionReality {
  return { read: async () => row }
}

/** The baseline with `narduk-core` gone from the manifest: item 2 fails. */
async function run(
  exception: FoundationExceptionReality | undefined,
  generated = GENERATED,
): Promise<AdoptionArtefact> {
  const root = makeTempRepo()
  tempDirs.push(root)
  writeAdoptionBaseline(root)
  const { '@narduk-enterprises/narduk-core': _core, ...pins } = BASELINE_PINS
  writeJson(root, 'package.json', {
    dependencies: pins,
    engines: { node: NODE },
    name: 'fixture-app',
    packageManager: `pnpm@${PNPM}`,
    scripts: { 'manifests:validate': 'true' },
  })
  return runAdoptionCheck({
    appOverrides: { repo: REPO },
    dependabotReality: NO_ALERTS,
    foundationException: exception,
    generated,
    liveRetry: { attempts: 1 },
    reality: baselineReality(),
    root,
    toolVersion: TOOL_VERSION,
  })
}

const r4 = (artefact: AdoptionArtefact) => artefact.requirements.find((r) => r.id === 'R4')!

describe('R4 and the portal foundation_exception row', () => {
  it('fails on item 2 with no row (the regression guard)', async () => {
    const artefact = await run(holding(null))
    expect(r4(artefact).verdict).toBe('fail')
    expect(r4(artefact).detail).toContain('item 2')
  })

  it('an unexpired row covers the item it names and says so', async () => {
    const artefact = await run(holding(ROW))
    expect(r4(artefact).verdict).not.toBe('fail')
    expect(r4(artefact).detail).toContain('covered by foundation_exception D-FOCUS-1')
    expect(r4(artefact).detail).toContain('item 2')
  })

  it('an expired row fails', async () => {
    const artefact = await run(holding(ROW), '2027-03-30T00:00:00.000Z')
    expect(r4(artefact).verdict).toBe('fail')
    expect(r4(artefact).detail).toContain('expired 2027-03-29')
  })

  it('covers through the expiry day itself', async () => {
    const artefact = await run(holding(ROW), '2027-03-29T23:59:59.000Z')
    expect(r4(artefact).verdict).not.toBe('fail')
  })

  it('a malformed expiry covers nothing', async () => {
    const artefact = await run(holding({ ...ROW, expiresOn: 'soon' }))
    expect(r4(artefact).verdict).toBe('fail')
  })

  it('an item the row does not name still fails', async () => {
    const artefact = await run(holding({ ...ROW, items: [3] }))
    expect(r4(artefact).verdict).toBe('fail')
    expect(r4(artefact).detail).toContain('item 2')
  })

  it('a row scoped to another repository covers nothing', async () => {
    const artefact = await run(holding({ ...ROW, repos: ['narduk-enterprises/other'] }))
    expect(r4(artefact).verdict).toBe('fail')
  })

  it('a row scoped to this repository covers', async () => {
    const artefact = await run(holding({ ...ROW, repos: [REPO] }))
    expect(r4(artefact).verdict).not.toBe('fail')
  })

  it('leaves the foundation item itself failing', async () => {
    const artefact = await run(holding(ROW))
    expect(artefact.result).not.toBe('PASS')
  })
})

describe('the portal reader fails closed', () => {
  const table = (rows: Array<Record<string, unknown>>) => ({
    json: async () => ({ rows }),
    status: 200,
  })
  const fetchFor =
    (extra: Array<Record<string, unknown>> = []) =>
    async (url: string) => {
      if (url.endsWith('/foundation_exception')) {
        return table([
          {
            app_id: 'app-1',
            decision: 'D-FOCUS-1',
            expires_on: '2027-03-29',
            id: 'fx-1',
            issue: 'https://example.test/issues/1',
            items: '[2,3]',
            repos: '[]',
          },
          ...extra,
        ])
      }
      if (url.endsWith('/app_repo')) return table([{ app_id: 'app-1', repo_id: 'repo-1' }])
      if (url.endsWith('/repo'))
        return table([{ id: 'repo-1', name: 'pacc-trac', org_id: 'org-1' }])
      if (url.endsWith('/app')) return table([{ id: 'app-1' }])
      return table([{ id: 'org-1', name: 'narduk-enterprises-clients' }])
    }
  const env = {
    [FOUNDATION_EXCEPTION_TOKEN_ENV]: 'token',
    GITHUB_REPOSITORY: REPO,
    OPERATOR_PORTAL_URL: 'https://portal.example.test',
  }

  it('joins the row to the repository through app_repo', async () => {
    const reality = createPortalFoundationExceptionReality({ env, fetch: fetchFor() })
    expect(await reality.read(REPO)).toMatchObject({ items: [2, 3], expiresOn: '2027-03-29' })
    expect(await reality.read('narduk-enterprises/unlinked')).toBeNull()
  })

  it('reads nothing under a repository the run does not own', async () => {
    const reality = createPortalFoundationExceptionReality({
      env: { ...env, GITHUB_REPOSITORY: 'narduk-enterprises/impostor' },
      fetch: fetchFor(),
    })
    expect(await reality.read(REPO)).toBeNull()
  })

  it('reads nothing when two apps share the repository', async () => {
    const shared = async (url: string) =>
      url.endsWith('/app_repo')
        ? table([
            { app_id: 'app-1', repo_id: 'repo-1' },
            { app_id: 'app-2', repo_id: 'repo-1' },
          ])
        : url.endsWith('/app')
          ? table([{ id: 'app-1' }, { id: 'app-2' }])
          : fetchFor()(url)
    const reality = createPortalFoundationExceptionReality({ env, fetch: shared })
    expect(await reality.read(REPO)).toBeNull()
  })

  it('reads nothing for an app that is no longer live', async () => {
    const retired = async (url: string) => (url.endsWith('/app') ? table([]) : fetchFor()(url))
    const reality = createPortalFoundationExceptionReality({ env, fetch: retired })
    expect(await reality.read(REPO)).toBeNull()
  })

  it('reads nothing without a credential', async () => {
    const reality = createPortalFoundationExceptionReality({
      env: { OPERATOR_PORTAL_URL: env.OPERATOR_PORTAL_URL },
      fetch: fetchFor(),
    })
    expect(await reality.read(REPO)).toBeNull()
  })

  it('reads nothing when the portal errors', async () => {
    const reality = createPortalFoundationExceptionReality({
      env,
      fetch: async () => ({ json: async () => ({}), status: 503 }),
    })
    expect(await reality.read(REPO)).toBeNull()
  })

  it('reads nothing from two rows for one repository', async () => {
    const reality = createPortalFoundationExceptionReality({
      env,
      fetch: fetchFor([
        {
          app_id: 'app-1',
          decision: 'x',
          expires_on: '2027-01-01',
          id: 'fx-2',
          issue: 'y',
          items: '[1]',
          repos: '[]',
        },
      ]),
    })
    expect(await reality.read(REPO)).toBeNull()
  })

  it('reads nothing from a malformed row', async () => {
    const reality = createPortalFoundationExceptionReality({
      env,
      fetch: async (url: string) =>
        url.endsWith('/foundation_exception')
          ? table([{ app_id: 'app-1', expires_on: '2027-01-01', items: '[9]', repos: '[]' }])
          : fetchFor()(url),
    })
    expect(await reality.read(REPO)).toBeNull()
  })

  describe('with an app-scoped foundation-exception-only key', () => {
    const scoped =
      (rows: Array<Record<string, unknown>>, joinStatus = 403) =>
      async (url: string) =>
        url.endsWith('/foundation_exception')
          ? table(rows)
          : { json: async () => ({}), status: joinStatus }
    const own = {
      app_id: 'app-1',
      decision: 'D-FOCUS-1',
      expires_on: '2027-03-29',
      issue: 'https://example.test/issues/1',
      items: '[2,3]',
      repos: '[]',
    }

    it('trusts the app-bound row when every join table is 403', async () => {
      const reality = createPortalFoundationExceptionReality({ env, fetch: scoped([own]) })
      expect(await reality.read(REPO)).toMatchObject({ items: [2, 3], expiresOn: '2027-03-29' })
    })

    it('reads nothing when the scoped key sees no row', async () => {
      const reality = createPortalFoundationExceptionReality({ env, fetch: scoped([]) })
      expect(await reality.read(REPO)).toBeNull()
    })

    it('reads nothing from two scoped rows', async () => {
      const reality = createPortalFoundationExceptionReality({
        env,
        fetch: scoped([own, { ...own, items: '[1]' }]),
      })
      expect(await reality.read(REPO)).toBeNull()
    })

    it('fails closed when the join tables error with anything but 403', async () => {
      const reality = createPortalFoundationExceptionReality({
        env,
        fetch: scoped([own], 503),
      })
      expect(await reality.read(REPO)).toBeNull()
    })

    it('fails closed when only some join tables are 403', async () => {
      const partial = async (url: string) =>
        url.endsWith('/app_repo') ? { json: async () => ({}), status: 403 } : fetchFor()(url)
      const reality = createPortalFoundationExceptionReality({ env, fetch: partial })
      expect(await reality.read(REPO)).toBeNull()
    })

    it('fails closed when foundation_exception itself is 403', async () => {
      const reality = createPortalFoundationExceptionReality({
        env,
        fetch: async () => ({ json: async () => ({}), status: 403 }),
      })
      expect(await reality.read(REPO)).toBeNull()
    })

    it('still refuses a repository the run does not own', async () => {
      const reality = createPortalFoundationExceptionReality({
        env: { ...env, GITHUB_REPOSITORY: 'narduk-enterprises/impostor' },
        fetch: scoped([own]),
      })
      expect(await reality.read(REPO)).toBeNull()
    })
  })
})
