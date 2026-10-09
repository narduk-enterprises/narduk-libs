import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runDataCacheCheckCommand } from '../../src/commands/data-cache-check.js'
import { runDataCacheCheck } from '../../src/foundation/evaluate-data-cache.js'
import { ssrFetchPaths } from '../../src/foundation/items/item-15-public-reads-cached.js'
import { makeTempRepo, writeFile, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function app(files: Record<string, string>): string {
  const root = makeTempRepo()
  tempDirs.push(root)
  writeJson(root, 'package.json', { name: 'fixture' })
  for (const [rel, text] of Object.entries(files)) writeFile(root, rel, text)
  return root
}

function run(files: Record<string, string>) {
  return runDataCacheCheck({ root: app(files), toolVersion: 'test' })
}

const UNCACHED = `export default defineEventHandler(async (event) => {
  const db = useDatabase(event)
  return db.select().from(stations).all()
})
`

describe('item 15 public-reads-are-cached (15.1)', () => {
  it('warns on a public GET route that reads D1 with no profile and no cache layer', () => {
    const artefact = run({ 'apps/web/server/api/stations.get.ts': UNCACHED })

    expect(artefact.item).toMatchObject({ id: 15, name: 'public-reads-are-cached', status: 'pass' })
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
    expect(artefact.mode).toBe('warn')
    expect(artefact.findings).toHaveLength(1)
    expect(artefact.findings[0]).toMatchObject({
      kind: 'uncached-route',
      file: 'apps/web/server/api/stations.get.ts',
      url: '/api/stations',
      reaches: 'direct',
    })
    expect(artefact.advisories[0]).toContain('apps/web/server/api/stations.get.ts')
    expect(artefact.item.checks[0]?.detail).toContain('1 warned')
  })

  it('treats a route with no method suffix as a GET and maps [id] to :id', () => {
    const artefact = run({
      'server/api/stations/[id].ts': `export default defineEventHandler((event) => {
  return event.context.cloudflare.env.DB.prepare('SELECT 1').first()
})`,
    })
    expect(artefact.findings[0]).toMatchObject({ url: '/api/stations/:id', reaches: 'direct' })
  })

  it('ignores routes that answer another method', () => {
    const artefact = run({ 'server/api/stations.post.ts': UNCACHED })
    expect(artefact.findings).toEqual([])
    expect(artefact.item.checks[0]?.status).toBe('not-applicable')
  })

  it('ignores a route that reads no D1', () => {
    const artefact = run({
      'server/api/health.get.ts': 'export default defineEventHandler(() => ({ ok: true }))',
    })
    expect(artefact.findings).toEqual([])
    expect(artefact.item.checks[0]?.detail).toContain('0 of 1 GET route(s) reach D1')
  })

  it('is not-applicable when the app has no server routes', () => {
    const artefact = run({})
    expect(artefact.item.status).toBe('not-applicable')
    expect(artefact.advisories).toEqual([])
  })

  it('does not warn on a route with a public cache profile', () => {
    for (const body of [
      "setCacheProfile(event, 'live')",
      'setCacheProfile(event, { maxAge: 30, sMaxAge: 120, swr: 600 })',
      "setResponseHeader(event, 'Cache-Control', 'public, s-maxage=60')",
    ]) {
      const artefact = run({
        'server/api/stations.get.ts': `export default defineEventHandler(async (event) => {
  ${body}
  return useDatabase(event).select().from(stations).all()
})`,
      })
      expect(artefact.findings, body).toEqual([])
    }
  })

  it('does not warn on a route behind withWorkerCache, withKVCache or withD1Cache', () => {
    for (const layer of ['withWorkerCache', 'withKVCache', 'withD1Cache']) {
      const artefact = run({
        'server/api/stations.get.ts': `export default defineEventHandler(async (event) => {
  const db = getD1CacheDB(event)
  return ${layer}(event, { key: 'stations' }, () => db.prepare('SELECT 1').all())
})`,
      })
      expect(artefact.findings, layer).toEqual([])
    }
  })

  it('does not take a commented-out cache call for a cache layer', () => {
    const artefact = run({
      'server/api/stations.get.ts': `export default defineEventHandler(async (event) => {
  // setCacheProfile(event, 'live')
  /* withWorkerCache(event, {}, () => null) */
  return useDatabase(event).select().from(stations).all()
})`,
    })
    expect(artefact.findings).toHaveLength(1)
  })

  it('follows one helper hop through an import', () => {
    const artefact = run({
      'server/api/stations.get.ts': `import { listStations } from '../utils/stations'
export default defineEventHandler((event) => listStations(event))`,
      'server/utils/stations.ts': `export function listStations(event) {
  return useDatabase(event).select().from(stations).all()
}`,
    })
    expect(artefact.findings[0]).toMatchObject({
      kind: 'uncached-route',
      reaches: { helper: 'server/utils/stations.ts' },
    })
    expect(artefact.advisories[0]).toContain('through server/utils/stations.ts')
  })

  it('follows a server/utils helper Nitro auto-imports', () => {
    const artefact = run({
      'apps/web/server/api/stations.get.ts': `export default defineEventHandler((event) => listStations(event))`,
      'apps/web/server/utils/stations.ts': `export async function listStations(event) {
  return getD1CacheDB(event).prepare('SELECT * FROM stations').all()
}`,
    })
    expect(artefact.findings[0]).toMatchObject({
      reaches: { helper: 'apps/web/server/utils/stations.ts' },
    })
  })

  it('does not follow a helper the route never calls', () => {
    const artefact = run({
      'server/api/ping.get.ts': `import { listStations } from '../utils/stations'
export default defineEventHandler(() => 'pong')`,
      'server/utils/stations.ts': `export function listStations(db) { return db.prepare('SELECT 1').all() }`,
    })
    expect(artefact.findings).toEqual([])
  })

  it('treats a helper that caches inside itself as cached', () => {
    const artefact = run({
      'server/api/stations.get.ts': `export default defineEventHandler((event) => listStations(event))`,
      'server/utils/stations.ts': `export function listStations(event) {
  const db = getD1CacheDB(event)
  return withWorkerCache(event, { key: 'stations' }, () => db.prepare('SELECT 1').all())
}`,
    })
    expect(artefact.findings).toEqual([])
  })

  it('follows a ~~/ alias import', () => {
    const artefact = run({
      'apps/web/server/api/stations.get.ts': `import * as stations from '~~/server/lib/stations'
export default defineEventHandler((event) => stations.list(event))`,
      'apps/web/server/lib/stations.ts': `export const list = (event) => useDatabase(event).query.stations.findMany()`,
    })
    expect(artefact.findings[0]).toMatchObject({
      reaches: { helper: 'apps/web/server/lib/stations.ts' },
    })
  })
})

describe('item 15 exemptions', () => {
  const cases: Array<[string, string, string]> = [
    [
      'setCacheProfile none',
      'server/api/me/stations.get.ts',
      `setCacheProfile(event, 'none')\n  return useDatabase(event).select().from(stations).all()`,
    ],
    [
      'no-store',
      'server/api/stations.get.ts',
      `setResponseHeader(event, 'Cache-Control', 'no-store')\n  return useDatabase(event).select().from(stations).all()`,
    ],
    [
      'auth guard',
      'server/api/stations.get.ts',
      `await requireAuth(event)\n  return useDatabase(event).select().from(stations).all()`,
    ],
    [
      'admin guard',
      'server/api/stations.get.ts',
      `await requireAdmin(event)\n  return useDatabase(event).select().from(stations).all()`,
    ],
    [
      'admin path',
      'server/api/admin/stations.get.ts',
      `return useDatabase(event).select().from(stations).all()`,
    ],
  ]

  it.each(cases)('exempts %s', (label, file, body) => {
    const artefact = run({
      [file]: `export default defineEventHandler(async (event) => {\n  ${body}\n})`,
    })
    expect(artefact.findings, label).toEqual([])
    expect(artefact.exempt).toHaveLength(1)
    expect(artefact.exempt[0]?.file).toBe(file)
  })

  it('does not let a commented-out guard exempt a route', () => {
    const artefact = run({
      'server/api/stations.get.ts': `export default defineEventHandler(async (event) => {
  // await requireAdmin(event)
  return useDatabase(event).select().from(stations).all()
})`,
    })
    expect(artefact.findings).toHaveLength(1)
  })
})

describe('item 15 escape comment', () => {
  it('suppresses a route and records the reason', () => {
    const artefact = run({
      'server/api/stations/[id].get.ts': `// narduk-cache: intentionally-uncached single primary-key read, cheaper than the lookup
export default defineEventHandler((event) => useDatabase(event).select().from(stations).get())`,
    })
    expect(artefact.findings).toEqual([])
    expect(artefact.suppressed).toEqual([
      {
        file: 'server/api/stations/[id].get.ts',
        reason: 'single primary-key read, cheaper than the lookup',
      },
    ])
  })

  it('accepts a block comment and a colon before the reason', () => {
    const artefact = run({
      'server/api/a.get.ts': `/* narduk-cache: intentionally-uncached: operator view */
export default defineEventHandler((event) => useDatabase(event).select().from(a).all())`,
    })
    expect(artefact.suppressed[0]?.reason).toBe('operator view')
  })

  it('warns on a marker with no reason', () => {
    const artefact = run({
      'server/api/a.get.ts': `// narduk-cache: intentionally-uncached
export default defineEventHandler((event) => useDatabase(event).select().from(a).all())`,
    })
    expect(artefact.suppressed).toEqual([])
    expect(artefact.findings[0]).toMatchObject({ kind: 'escape-without-reason' })
    expect(artefact.advisories[0]).toContain('no reason')
  })
})

describe('item 15 SSR fetches (15.2)', () => {
  const ROUTE_WITH_PROFILE = `export default defineEventHandler(async (event) => {
  setCacheProfile(event, 'live')
  return useDatabase(event).select().from(stations).all()
})`
  const PAGE = `<script setup lang="ts">
const { data } = await useFetch('/api/stations')
</script>
<template><div>{{ data }}</div></template>`

  it('warns when a page SSR-fetches a route that has a profile but no withWorkerCache', () => {
    const artefact = run({
      'apps/web/server/api/stations.get.ts': ROUTE_WITH_PROFILE,
      'apps/web/app/pages/index.vue': PAGE,
    })

    // 15.1 is quiet: the route has a public profile.
    expect(artefact.findings.map((f) => f.kind)).toEqual(['ssr-uncached-route'])
    expect(artefact.findings[0]).toMatchObject({
      consumer: 'apps/web/app/pages/index.vue',
      file: 'apps/web/server/api/stations.get.ts',
      fetchPath: '/api/stations',
    })
    expect(artefact.advisories[0]).toContain('edge header')
    expect(artefact.item.checks[1]?.detail).toContain('1 warned')
  })

  it('is quiet when the route caches in-process', () => {
    const artefact = run({
      'server/api/stations.get.ts': `export default defineEventHandler(async (event) => {
  setCacheProfile(event, 'live')
  const db = getD1CacheDB(event)
  return withWorkerCache(event, { key: 'stations', scope: 'public', freshSeconds: 60 }, () => db.prepare('SELECT 1').all())
})`,
      'app/pages/index.vue': PAGE,
    })
    expect(artefact.findings).toEqual([])
    expect(artefact.item.checks[1]?.status).toBe('pass')
  })

  it('reaches the route through a template literal and useAsyncData', () => {
    const artefact = run({
      'server/api/stations/[id].get.ts': ROUTE_WITH_PROFILE,
      'app/composables/useStation.ts': `export function useStation(id: string) {
  return useAsyncData(\`station-\${id}\`, () => $fetch(\`/api/stations/\${id}?full=1\`))
}`,
    })
    expect(artefact.findings[0]).toMatchObject({
      kind: 'ssr-uncached-route',
      consumer: 'app/composables/useStation.ts',
      fetchPath: '/api/stations/x',
      url: '/api/stations/:id',
    })
  })

  it('skips a fetch with server: false', () => {
    const artefact = run({
      'server/api/stations.get.ts': ROUTE_WITH_PROFILE,
      'app/pages/index.vue': `<script setup>
const { data } = useFetch('/api/stations', { server: false })
</script>`,
    })
    expect(artefact.findings).toEqual([])
    expect(artefact.item.checks[1]?.status).toBe('not-applicable')
  })

  it('skips a fetch of a session-bound route and of a suppressed one', () => {
    const artefact = run({
      'server/api/me.get.ts': `export default defineEventHandler(async (event) => {
  await requireAuth(event)
  return useDatabase(event).select().from(users).get()
})`,
      'server/api/ops.get.ts': `// narduk-cache: intentionally-uncached writes must show at once
export default defineEventHandler((event) => {
  setCacheProfile(event, 'live')
  return useDatabase(event).select().from(ops).all()
})`,
      'app/pages/a.vue': `<script setup>
const a = await useFetch('/api/me')
const b = await useFetch('/api/ops')
</script>`,
    })
    expect(artefact.findings).toEqual([])
  })

  it('ignores a fetch of an external URL and a commented-out fetch', () => {
    expect(ssrFetchPaths(`useFetch('https://api.example.com/stations')`, false)).toEqual([])
    expect(ssrFetchPaths(`// useFetch('/api/stations')`, false)).toEqual([])
    expect(ssrFetchPaths(`<!-- useFetch('/api/stations') -->`, true)).toEqual([])
    expect(ssrFetchPaths(`useLazyFetch<Item[]>('/api/items/')`, false)).toEqual(['/api/items'])
  })
})

describe('foundation:check:data-cache command', () => {
  it('prints the warnings, exits 0 and writes the artefact', () => {
    const root = app({ 'server/api/stations.get.ts': UNCACHED })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { exitCode, artefact } = runDataCacheCheckCommand({
      checkoutDir: root,
      jsonPath: null,
      json: false,
    })

    expect(exitCode).toBe(0)
    expect(artefact.tool).toBe('@narduk-enterprises/narduk-app-tools/data-cache')
    const text = log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(text).toContain('[WARN] server/api/stations.get.ts')
    expect(text).toContain('RESULT: PASS (warn mode)')
    expect(text).toContain('Worker data cache: withWorkerCache')
  })
})
