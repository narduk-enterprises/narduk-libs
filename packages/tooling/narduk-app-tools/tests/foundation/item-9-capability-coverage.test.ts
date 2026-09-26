import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { SHARED_CAPABILITY_CATALOG } from '../../src/foundation/capability-catalog.js'
import { evaluateItem9 } from '../../src/foundation/items/item-9-capability-coverage.js'
import { AppRepo } from '../../src/foundation/source.js'
import type { FoundationStatus } from '../../src/foundation/types.js'
import { makeTempRepo, writeFile, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function repoWith(write: (root: string) => void): AppRepo {
  const root = makeTempRepo()
  tempDirs.push(root)
  write(root)
  return new AppRepo(root)
}

function statusOf(repo: AppRepo, id: string): FoundationStatus {
  const found = evaluateItem9(repo).checks.find((c) => c.id === id)
  if (!found) throw new Error(`no sub-check ${id}`)
  return found.status
}

function detailOf(repo: AppRepo, id: string): string {
  const found = evaluateItem9(repo).checks.find((c) => c.id === id)
  if (!found) throw new Error(`no sub-check ${id}`)
  return found.detail
}

/** The smallest manifest that makes an app "a narduk app with a UI and a
 * server". Every detector fixture starts here and changes exactly one fact. */
function baseline(root: string, dependencies: Record<string, string> = {}): void {
  writeJson(root, 'package.json', {
    name: 'coverage-fixture',
    dependencies: {
      '@narduk-enterprises/narduk-core': '2.0.0',
      ...dependencies,
    },
  })
  writeFile(root, 'nuxt.config.ts', 'export default defineNuxtConfig({})\n')
  writeFile(root, 'app/pages/index.vue', '<template><div /></template>\n')
}

// ── Part (a): inventory ───────────────────────────────────────────────────

describe('item 9.0-9.2 -- estate dependency inventory', () => {
  it('9.0 is unknown when no package.json is readable at a known path', () => {
    const repo = repoWith(() => {})
    const evaluation = evaluateItem9(repo)
    expect(evaluation.checks).toHaveLength(1)
    expect(evaluation.checks[0].id).toBe('9.0')
    expect(evaluation.checks[0].status).toBe('unknown')
    expect(evaluation.detections).toEqual([])
  })

  it('records one row per (package, manifest, block) across root and workspace manifests', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeJson(root, 'package.json', {
        name: 'root',
        devDependencies: { '@narduk-enterprises/narduk-app-tools': '0.4.2' },
      })
      writeJson(root, 'apps/web/package.json', {
        name: 'web',
        dependencies: {
          '@narduk-enterprises/narduk-core': '2.0.0',
          '@narduk-enterprises/narduk-seo': '2.2.0',
          nuxt: '4.5.2',
        },
        devDependencies: { '@narduk-enterprises/narduk-testkit': '1.3.2' },
      })
    })
    const { inventory } = evaluateItem9(repo)

    expect(inventory.manifests).toEqual(['package.json', 'apps/web/package.json'])
    expect(inventory.dependencies).toEqual([
      {
        package: '@narduk-enterprises/narduk-app-tools',
        version: '0.4.2',
        manifest: 'package.json',
        block: 'devDependencies',
        capability: 'app-tools',
      },
      {
        package: '@narduk-enterprises/narduk-core',
        version: '2.0.0',
        manifest: 'apps/web/package.json',
        block: 'dependencies',
        capability: 'core',
      },
      {
        package: '@narduk-enterprises/narduk-seo',
        version: '2.2.0',
        manifest: 'apps/web/package.json',
        block: 'dependencies',
        capability: 'seo',
      },
      {
        package: '@narduk-enterprises/narduk-testkit',
        version: '1.3.2',
        manifest: 'apps/web/package.json',
        block: 'devDependencies',
        capability: 'testkit',
      },
    ])
    // `nuxt` is not an estate package and must not appear in the roster.
    expect(inventory.dependencies.some((row) => row.package === 'nuxt')).toBe(false)
  })

  it('marks every catalog capability adopted or not, and carries the whole catalog', () => {
    const repo = repoWith((root) => baseline(root, { '@narduk-enterprises/narduk-seo': '2.2.0' }))
    const { inventory } = evaluateItem9(repo)

    expect(inventory.capabilities).toHaveLength(SHARED_CAPABILITY_CATALOG.length)
    const byId = new Map(inventory.capabilities.map((c) => [c.id, c]))
    expect(byId.get('seo')).toMatchObject({
      adopted: true,
      version: '2.2.0',
      package: '@narduk-enterprises/narduk-seo',
      manifests: ['package.json'],
    })
    expect(byId.get('uploads')).toMatchObject({ adopted: false, version: null, manifests: [] })
  })

  // narduk-libs#620: a pin plus an app-local copy of the internals is a fork.
  function mapkitApp(root: string, pinned: boolean): void {
    baseline(root, pinned ? { '@narduk-enterprises/narduk-mapkit': '2.0.0' } : {})
    writeFile(
      root,
      'apps/web/app/utils/mapkit/marks.ts',
      'export const a = 1\nexport const b = 2\n',
    )
    writeFile(root, 'apps/web/app/assets/css/mapkit.css', '.mk-callout {\n}\n')
    // Adapts the package, so it is adoption, not a copy.
    writeFile(
      root,
      'apps/web/app/components/mapkit/BuoyLayer.vue',
      '<script setup lang="ts">\nimport { AppMapKit } from \'@narduk-enterprises/narduk-mapkit-nuxt\'\n</script>\n',
    )
    // A stem inside a longer name is not matched.
    writeFile(root, 'apps/web/app/components/BuoyMapKitHost.vue', '<template><div /></template>\n')
  }

  it('a pinned capability with an app-local copy is forked, not adopted, and 9.1 says so', () => {
    const repo = repoWith((root) => mapkitApp(root, true))
    const mapkit = evaluateItem9(repo).inventory.capabilities.find((c) => c.id === 'mapkit')
    expect(mapkit).toMatchObject({
      state: 'forked',
      adopted: false,
      fork: {
        files: ['apps/web/app/assets/css/mapkit.css', 'apps/web/app/utils/mapkit/marks.ts'],
        lines: 4,
      },
    })
    expect(statusOf(repo, '9.1')).toBe('pass')
    const detail = detailOf(repo, '9.1')
    expect(detail).not.toMatch(/adopted: [^;]*\bmapkit\b/u)
    expect(detail).toContain(
      'forked (pinned, with an app-local copy): mapkit (2 file(s), 4 line(s)',
    )
  })

  it('the same tree without the pin is absent, and a pin with no copy is adopted', () => {
    const unpinned = repoWith((root) => mapkitApp(root, false))
    expect(
      evaluateItem9(unpinned).inventory.capabilities.find((c) => c.id === 'mapkit'),
    ).toMatchObject({ state: 'absent', adopted: false, fork: null })

    const clean = repoWith((root) =>
      baseline(root, { '@narduk-enterprises/narduk-mapkit': '2.0.0' }),
    )
    expect(
      evaluateItem9(clean).inventory.capabilities.find((c) => c.id === 'mapkit'),
    ).toMatchObject({ state: 'adopted', adopted: true, fork: null })
    expect(detailOf(clean, '9.1')).not.toContain('forked')
  })

  it('a capability without forkStems is never forked, whatever the app names its code', () => {
    const repo = repoWith((root) => {
      baseline(root, { '@narduk-enterprises/narduk-seo': '2.2.0' })
      writeFile(root, 'app/utils/seo/meta.ts', 'export const title = "x"\n')
    })
    expect(evaluateItem9(repo).inventory.capabilities.find((c) => c.id === 'seo')).toMatchObject({
      state: 'adopted',
      fork: null,
    })
  })

  it('9.2 is unknown for an estate pin the catalog cannot classify, pass otherwise', () => {
    const clean = repoWith((root) => baseline(root))
    expect(statusOf(clean, '9.2')).toBe('pass')

    const retired = repoWith((root) =>
      baseline(root, { '@narduk-enterprises/narduk-skills': '1.0.0' }),
    )
    expect(statusOf(retired, '9.2')).toBe('unknown')
    expect(evaluateItem9(retired).inventory.unclassified).toEqual([
      '@narduk-enterprises/narduk-skills',
    ])
  })
})

// ── Part (b): reimplementation detection ──────────────────────────────────

describe('item 9.3 -- app-local logger', () => {
  const appLocalLogger = [
    "type Level = 'info' | 'warn' | 'error'",
    'export function createLogger(scope: string) {',
    '  return {',
    '    info: (message: string) => console.log(`[${scope}] ${message}`),',
    '    error: (message: string) => console.error(`[${scope}] ${message}`),',
    '  }',
    '}',
    'export type { Level }',
  ].join('\n')

  it('fails with the exact path and the owning package when narduk-logging is a dependency', () => {
    const repo = repoWith((root) => {
      baseline(root, { '@narduk-enterprises/narduk-logging': '0.1.0' })
      writeFile(root, 'app/utils/logger.ts', appLocalLogger)
    })
    expect(statusOf(repo, '9.3')).toBe('fail')
    expect(detailOf(repo, '9.3')).toContain('app/utils/logger.ts')
    expect(detailOf(repo, '9.3')).toContain('@narduk-enterprises/narduk-logging')

    const detection = evaluateItem9(repo).detections.find((d) => d.subCheck === '9.3')
    expect(detection).toMatchObject({
      confidence: 'confirmed',
      path: 'app/utils/logger.ts',
      capability: 'logging',
      ownedBy: '@narduk-enterprises/narduk-logging',
    })
  })

  it('narduk-core alone also confirms it -- core and the logging module share the Nitro guard', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(root, 'app/utils/logger.ts', appLocalLogger)
    })
    expect(statusOf(repo, '9.3')).toBe('fail')
  })

  it('is a heuristic WARN (unknown) when no logging-owning package is a dependency', () => {
    const repo = repoWith((root) => {
      writeJson(root, 'package.json', { name: 'x', dependencies: {} })
      writeFile(root, 'nuxt.config.ts', 'export default defineNuxtConfig({})\n')
      writeFile(root, 'app/utils/logger.ts', appLocalLogger)
    })
    expect(statusOf(repo, '9.3')).toBe('unknown')
    expect(detailOf(repo, '9.3')).toContain('heuristic match (WARN)')
    expect(evaluateItem9(repo).detections[0]).toMatchObject({ confidence: 'heuristic' })
  })

  it('does not flag an app that imports createLogger from the shared package', () => {
    const repo = repoWith((root) => {
      baseline(root, { '@narduk-enterprises/narduk-logging': '0.1.0' })
      writeFile(
        root,
        'app/utils/logger.ts',
        [
          "import { createLogger } from '@narduk-enterprises/narduk-logging'",
          "export const logger = createLogger({ service: 'fixture' })",
          "console.log('bootstrapped')",
        ].join('\n'),
      )
    })
    expect(statusOf(repo, '9.3')).toBe('pass')
  })

  it('does not flag a bare console call with no logger implementation around it', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(root, 'app/utils/debug.ts', "export function ping() {\n  console.log('pong')\n}\n")
    })
    expect(statusOf(repo, '9.3')).toBe('pass')
  })

  it('does not flag a createLogger declaration with no console transport', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(
        root,
        'app/utils/metrics.ts',
        'function createLogger() {\n  return { info: () => undefined }\n}\nexport { createLogger }\n',
      )
    })
    expect(statusOf(repo, '9.3')).toBe('pass')
  })
})

describe('item 9.4 -- copied narduk-seo helpers', () => {
  it('fails an app-local useSeo twin when narduk-seo is a dependency', () => {
    const repo = repoWith((root) => {
      baseline(root, { '@narduk-enterprises/narduk-seo': '2.2.0' })
      writeFile(
        root,
        'app/composables/useSeo.ts',
        'export function useSeo(title: string) {\n  useSeoMeta({ title })\n}\n',
      )
    })
    expect(statusOf(repo, '9.4')).toBe('fail')
    expect(detailOf(repo, '9.4')).toContain('app/composables/useSeo.ts')
    expect(detailOf(repo, '9.4')).toContain('@narduk-enterprises/narduk-seo')
  })

  it('fails an app-local defaultSocialMeta twin', () => {
    const repo = repoWith((root) => {
      baseline(root, { '@narduk-enterprises/narduk-seo': '2.2.0' })
      writeFile(
        root,
        'app/utils/defaultSocialMeta.ts',
        "export const defaultSocialMeta = { ogType: 'website' }\n",
      )
    })
    expect(statusOf(repo, '9.4')).toBe('fail')
  })

  it('is a heuristic WARN when narduk-seo is not a dependency', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(root, 'app/composables/useSeo.ts', 'export function useSeo() {}\n')
    })
    expect(statusOf(repo, '9.4')).toBe('unknown')
    expect(detailOf(repo, '9.4')).toContain('heuristic match (WARN)')
  })

  it('does not flag a wrapper that imports from narduk-seo', () => {
    const repo = repoWith((root) => {
      baseline(root, { '@narduk-enterprises/narduk-seo': '2.2.0' })
      writeFile(
        root,
        'app/composables/useSeo.ts',
        [
          "import { useSeo as shared } from '@narduk-enterprises/narduk-seo'",
          'export const useSeo = shared',
        ].join('\n'),
      )
    })
    expect(statusOf(repo, '9.4')).toBe('pass')
  })

  it('does not flag ordinary useSeoMeta() calls', () => {
    const repo = repoWith((root) => {
      baseline(root, { '@narduk-enterprises/narduk-seo': '2.2.0' })
      writeFile(
        root,
        'app/pages/about.vue',
        '<script setup lang="ts">\nuseSeoMeta({ title: \'About\' })\n</script>\n',
      )
    })
    expect(statusOf(repo, '9.4')).toBe('pass')
  })
})

describe('item 9.5 -- analytics wrapper around posthog-js', () => {
  it('fails a direct posthog-js import when narduk-analytics is a dependency', () => {
    const repo = repoWith((root) => {
      baseline(root, {
        '@narduk-enterprises/narduk-analytics': '1.19.36',
        'posthog-js': '1.0.0',
      })
      writeFile(
        root,
        'app/plugins/analytics.client.ts',
        [
          "import posthog from 'posthog-js'",
          'export default defineNuxtPlugin(() => {',
          "  posthog.init('key')",
          '})',
        ].join('\n'),
      )
    })
    expect(statusOf(repo, '9.5')).toBe('fail')
    expect(detailOf(repo, '9.5')).toContain('app/plugins/analytics.client.ts')
    expect(detailOf(repo, '9.5')).toContain('@narduk-enterprises/narduk-analytics')
  })

  it('is a heuristic WARN for a posthog-js pin with no import in the scanned source', () => {
    const repo = repoWith((root) => {
      baseline(root, {
        '@narduk-enterprises/narduk-analytics': '1.19.36',
        'posthog-js': '1.0.0',
      })
    })
    expect(statusOf(repo, '9.5')).toBe('unknown')
    expect(detailOf(repo, '9.5')).toContain('heuristic match (WARN)')
    expect(evaluateItem9(repo).detections[0]).toMatchObject({
      confidence: 'heuristic',
      path: 'package.json',
    })
  })

  it('does not flag runtime config that merely names PostHog', () => {
    const repo = repoWith((root) => {
      baseline(root, { '@narduk-enterprises/narduk-analytics': '1.19.36' })
      writeFile(
        root,
        'app/utils/analytics-config.ts',
        [
          'export const analytics = {',
          "  posthogHost: 'https://p.nard.uk',",
          '  posthogPublicKey: process.env.POSTHOG_PUBLIC_KEY,',
          '}',
        ].join('\n'),
      )
    })
    expect(statusOf(repo, '9.5')).toBe('pass')
  })
})

describe('item 9.6 -- hand-rolled /api/health route', () => {
  it('fails a server/api health route that never calls registerHealthCheck', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(
        root,
        'server/api/health.get.ts',
        "export default defineEventHandler(() => ({ status: 'ok' }))\n",
      )
    })
    expect(statusOf(repo, '9.6')).toBe('fail')
    expect(detailOf(repo, '9.6')).toContain('server/api/health.get.ts')
    expect(detailOf(repo, '9.6')).toContain('@narduk-enterprises/narduk-core')
  })

  it('also catches the shared health route at a monorepo prefix', () => {
    const repo = repoWith((root) => {
      writeJson(root, 'apps/web/package.json', {
        name: 'web',
        dependencies: { '@narduk-enterprises/narduk-core': '2.0.0' },
      })
      writeFile(root, 'apps/web/nuxt.config.ts', 'export default defineNuxtConfig({})\n')
      writeFile(
        root,
        'apps/web/server/api/health/index.get.ts',
        'export default defineEventHandler(() => ({}))\n',
      )
    })
    expect(statusOf(repo, '9.6')).toBe('fail')
    expect(detailOf(repo, '9.6')).toContain('answers /api/health')
  })

  it('does not treat a versioned health route as /api/health', () => {
    const repo = repoWith((root) => {
      writeJson(root, 'apps/web/package.json', {
        name: 'web',
        dependencies: { '@narduk-enterprises/narduk-core': '2.0.0' },
      })
      writeFile(root, 'apps/web/nuxt.config.ts', 'export default defineNuxtConfig({})\n')
      writeFile(
        root,
        'apps/web/server/api/v1/health.get.ts',
        'export default defineEventHandler(() => ({}))\n',
      )
      writeFile(
        root,
        'apps/web/server/api/v1/health/index.get.ts',
        'export default defineEventHandler(() => ({}))\n',
      )
    })
    expect(statusOf(repo, '9.6')).toBe('pass')
  })

  it('is not-applicable when the app has no server/api directory', () => {
    const repo = repoWith((root) => baseline(root))
    expect(statusOf(repo, '9.6')).toBe('not-applicable')
  })

  it('does not flag other server/api routes, nor a health route that uses registerHealthCheck', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(root, 'server/api/stations.get.ts', 'export default defineEventHandler(() => [])\n')
      writeFile(
        root,
        'server/api/health.get.ts',
        [
          "import { registerHealthCheck } from '@narduk-enterprises/narduk-core/server/utils/health-checks'",
          'registerHealthCheck({ name: "publication", run: async () => ({}) })',
          'export default defineEventHandler(() => ({}))',
        ].join('\n'),
      )
    })
    expect(statusOf(repo, '9.6')).toBe('pass')
  })
})

describe('item 9.7 -- duplicate error plugin / response finish listener', () => {
  it('fails a Nitro plugin that hooks error and logs from it', () => {
    const repo = repoWith((root) => {
      baseline(root, { '@narduk-enterprises/narduk-logging': '0.1.0' })
      writeFile(
        root,
        'server/plugins/errors.ts',
        [
          'export default defineNitroPlugin((nitroApp) => {',
          "  nitroApp.hooks.hook('error', (error) => {",
          "    console.error('[app] request failed', error)",
          '  })',
          '})',
        ].join('\n'),
      )
    })
    expect(statusOf(repo, '9.7')).toBe('fail')
    expect(detailOf(repo, '9.7')).toContain('server/plugins/errors.ts')
    expect(detailOf(repo, '9.7')).toContain('@narduk-enterprises/narduk-logging')
  })

  it('fails a response finish listener that logs a request summary', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(
        root,
        'server/plugins/request-summary.ts',
        [
          'export default defineNitroPlugin((nitroApp) => {',
          "  nitroApp.hooks.hook('request', (event) => {",
          '    const started = Date.now()',
          "    event.node.res.on('finish', () => {",
          "      logger.info('Request completed', { durationMs: Date.now() - started })",
          '    })',
          '  })',
          '})',
        ].join('\n'),
      )
    })
    expect(statusOf(repo, '9.7')).toBe('fail')
  })

  it('does not flag a Nitro plugin that registers health checks and never logs', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(
        root,
        'server/plugins/health-checks.ts',
        [
          "import { registerHealthCheck } from '@narduk-enterprises/narduk-core/server/utils/health-checks'",
          'export default defineNitroPlugin(() => {',
          "  registerHealthCheck({ name: 'publication', required: true, async run() { return {} } })",
          '})',
        ].join('\n'),
      )
    })
    expect(statusOf(repo, '9.7')).toBe('pass')
  })

  it('does not flag product-specific error handling that does not log', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(
        root,
        'server/plugins/error-page.ts',
        [
          'export default defineNitroPlugin((nitroApp) => {',
          "  nitroApp.hooks.hook('error', (error, { event }) => {",
          '    if (event) event.node.res.statusCode = 500',
          '  })',
          '})',
        ].join('\n'),
      )
    })
    expect(statusOf(repo, '9.7')).toBe('pass')
  })

  it('is not-applicable with no server/plugins directory and no defineNitroPlugin', () => {
    const repo = repoWith((root) => baseline(root))
    expect(statusOf(repo, '9.7')).toBe('not-applicable')
  })
})

describe('item 9.8 -- hand-rolled narduk-data reader (narduk-libs#373)', () => {
  // The Buoys shape the issue names: its own origin constant, manifest fetch
  // and schema, none of the shared client's timeout/checksum/freshness policy.
  const HAND_ROLLED = [
    "const DATA_ORIGIN = 'https://data.nard.uk'",
    'export async function readBuoyStatus() {',
    '  const manifest = await $fetch(`${DATA_ORIGIN}/buoy-status-v1/manifest.json`)',
    '  return manifest',
    '}',
  ].join('\n')

  it('fails a server util that fetches data.nard.uk itself when narduk-core is pinned', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(root, 'server/utils/buoy-status-product.ts', HAND_ROLLED)
    })
    expect(statusOf(repo, '9.8')).toBe('fail')
    expect(detailOf(repo, '9.8')).toContain('server/utils/buoy-status-product.ts')
    expect(detailOf(repo, '9.8')).toContain('@narduk-enterprises/narduk-core')
  })

  it('catches a template-literal URL and a plain fetch', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(
        root,
        'apps/web/src/worker/obs/ndbc.ts',
        'export const read = () => fetch(`https://data.nard.uk/${product}/current/data.json`)\n',
      )
    })
    expect(statusOf(repo, '9.8')).toBe('fail')
  })

  it('warns rather than fails when narduk-core is not a dependency', () => {
    const repo = repoWith((root) => {
      writeJson(root, 'package.json', { name: 'worker-only', dependencies: {} })
      writeFile(root, 'src/border.ts', HAND_ROLLED)
    })
    expect(statusOf(repo, '9.8')).toBe('unknown')
  })

  it('does not flag an app configuring the shared client, auto-imported or imported', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(
        root,
        'server/utils/lake-data.ts',
        [
          "const client = createNardukDataClient({ origin: 'https://data.nard.uk' })",
          'export const readLake = () => client.read({ productId: "lakes-v1" })',
        ].join('\n'),
      )
      writeFile(
        root,
        'server/utils/news.ts',
        [
          "import { fetchNardukDataJson } from '@narduk-enterprises/narduk-core/server/utils/narduk-data'",
          "export const news = () => fetchNardukDataJson('https://data.nard.uk/news-v1/latest.json')",
        ].join('\n'),
      )
    })
    expect(statusOf(repo, '9.8')).toBe('pass')
  })

  it('does not flag a link to data.nard.uk that is never fetched', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(
        root,
        'app/components/Attribution.vue',
        '<template><a href="https://data.nard.uk">Data: narduk-data</a></template>\n',
      )
      writeFile(root, 'app/utils/source.ts', "export const SOURCE = 'https://data.nard.uk'\n")
    })
    expect(statusOf(repo, '9.8')).toBe('pass')
  })

  it('does not match a look-alike host', () => {
    const repo = repoWith((root) => {
      baseline(root)
      writeFile(
        root,
        'server/utils/other.ts',
        "export const read = () => fetch('https://data.nard.uk.example.com/x')\n",
      )
    })
    expect(statusOf(repo, '9.8')).toBe('pass')
  })
})
