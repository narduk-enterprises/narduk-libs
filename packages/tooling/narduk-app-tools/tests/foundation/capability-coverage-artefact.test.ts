import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import {
  CAPABILITY_COVERAGE_TOOL_NAME,
  formatCapabilityCoverageSummary,
  runCapabilityCoverageCheck,
} from '../../src/foundation/evaluate-capability-coverage.js'
import { makeTempRepo, writeFile, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function run(write: (root: string) => void) {
  const root = makeTempRepo()
  tempDirs.push(root)
  write(root)
  return runCapabilityCoverageCheck({
    root,
    toolVersion: '0.0.0-test',
    appOverrides: {
      repo: 'narduk-enterprises/fixture',
      commit: 'a'.repeat(40),
      ref: 'refs/heads/main',
    },
    generated: '2026-09-17T00:00:00.000Z',
  })
}

describe('capability-coverage artefact', () => {
  it('is its own document, never the ratified 7-item shape', () => {
    const artefact = run((root) => {
      writeJson(root, 'package.json', {
        name: 'x',
        dependencies: { '@narduk-enterprises/narduk-core': '2.0.0' },
      })
      writeFile(root, 'nuxt.config.ts', 'export default defineNuxtConfig({})\n')
      writeFile(root, 'app/pages/index.vue', '<template><div /></template>\n')
    })

    expect(artefact.tool).toBe(CAPABILITY_COVERAGE_TOOL_NAME)
    expect(artefact.tool).not.toBe('@narduk-enterprises/narduk-app-tools')
    expect(artefact.contract.items).toBe(1)
    expect(artefact.item.id).toBe(9)
    expect(artefact.item.name).toBe('shared-capability-coverage')
    // The 7-item rollup pattern-matches on `items`; this document must not
    // carry that key at all, or `check-web-foundation.py` would try to read it.
    expect('items' in artefact).toBe(false)
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
  })

  it('carries the inventory as data so the estate roster never parses prose', () => {
    const artefact = run((root) => {
      writeJson(root, 'package.json', {
        name: 'x',
        dependencies: {
          '@narduk-enterprises/narduk-core': '2.0.0',
          '@narduk-enterprises/narduk-seo': '2.2.0',
        },
      })
      writeFile(root, 'nuxt.config.ts', 'export default defineNuxtConfig({})\n')
      writeFile(root, 'app/pages/index.vue', '<template><div /></template>\n')
    })

    const roundTripped = JSON.parse(JSON.stringify(artefact)) as typeof artefact
    expect(
      roundTripped.inventory.dependencies.map((row) => `${row.package}@${row.version}`),
    ).toEqual(['@narduk-enterprises/narduk-core@2.0.0', '@narduk-enterprises/narduk-seo@2.2.0'])
    expect(roundTripped.inventory.capabilities.find((c) => c.id === 'seo')?.adopted).toBe(true)
    expect(roundTripped.scan.files).toBeGreaterThan(0)
  })

  it('exits 1 on a confirmed gap and names the file and owning package', () => {
    const artefact = run((root) => {
      writeJson(root, 'package.json', {
        name: 'x',
        dependencies: {
          '@narduk-enterprises/narduk-core': '2.0.0',
          '@narduk-enterprises/narduk-seo': '2.2.0',
        },
      })
      writeFile(root, 'nuxt.config.ts', 'export default defineNuxtConfig({})\n')
      writeFile(root, 'app/pages/index.vue', '<template><div /></template>\n')
      writeFile(root, 'app/composables/useSeo.ts', 'export function useSeo() {}\n')
    })

    expect(artefact.result).toBe('FAIL')
    expect(artefact.exitCode).toBe(1)
    expect(artefact.detections).toEqual([
      {
        subCheck: '9.4',
        capability: 'seo',
        ownedBy: '@narduk-enterprises/narduk-seo',
        confidence: 'confirmed',
        path: 'app/composables/useSeo.ts',
        detail: expect.stringContaining('narduk-seo'),
      },
    ])
    const summary = formatCapabilityCoverageSummary(artefact)
    expect(summary).toContain('[FAIL] item 9 shared-capability-coverage')
    expect(summary).toContain('app/composables/useSeo.ts')
    expect(summary).toContain('RESULT: FAIL')
  })

  it('exits 2 and prints WARN for a heuristic-only match', () => {
    const artefact = run((root) => {
      writeJson(root, 'package.json', { name: 'x', dependencies: {} })
      writeFile(root, 'nuxt.config.ts', 'export default defineNuxtConfig({})\n')
      writeFile(root, 'app/pages/index.vue', '<template><div /></template>\n')
      writeFile(root, 'app/composables/useSeo.ts', 'export function useSeo() {}\n')
    })

    expect(artefact.result).toBe('UNKNOWN')
    expect(artefact.exitCode).toBe(2)
    expect(artefact.detections[0].confidence).toBe('heuristic')
    const summary = formatCapabilityCoverageSummary(artefact)
    expect(summary).toContain('[WARN] 9.4')
    expect(summary).not.toContain('[UNKN] 9.4')
  })

  it('prints UNKN, not WARN, for an undecided sub-check with no detection behind it', () => {
    const artefact = run((root) => {
      writeJson(root, 'package.json', {
        name: 'x',
        dependencies: {
          '@narduk-enterprises/narduk-core': '2.0.0',
          '@narduk-enterprises/narduk-skills': '1.0.0',
        },
      })
      writeFile(root, 'nuxt.config.ts', 'export default defineNuxtConfig({})\n')
      writeFile(root, 'app/pages/index.vue', '<template><div /></template>\n')
    })

    expect(artefact.exitCode).toBe(2)
    expect(formatCapabilityCoverageSummary(artefact)).toContain('[UNKN] 9.2')
  })
})

/**
 * ZERO FALSE POSITIVES.
 *
 * Both fixtures below reproduce the exact shapes that would trip a naive
 * detector in the two checkouts the item was proven against: `buoys` at
 * cc72c3d (13 estate pins in two manifests, a Nitro plugin registering a
 * health check, PostHog named all over the analytics configuration) and a
 * `create-narduk-app@0.6.3` scaffold (a two-manifest workspace with no
 * server/api and no server/plugins at all). The live runs are recorded in the
 * pull request; these fixtures are what keeps them true.
 */
describe('zero false positives on conformant apps', () => {
  it('passes the Buoys shape: registered health checks, configured PostHog, no local twins', () => {
    const artefact = run((root) => {
      writeJson(root, 'package.json', {
        name: 'buoys',
        devDependencies: { '@narduk-enterprises/narduk-app-tools': '0.4.2' },
      })
      writeJson(root, 'apps/web/package.json', {
        name: 'web',
        dependencies: {
          '@narduk-enterprises/narduk-analytics': '1.19.36',
          '@narduk-enterprises/narduk-charts': '2.5.2',
          '@narduk-enterprises/narduk-core': '2.0.0',
          '@narduk-enterprises/narduk-seo': '2.2.0',
          '@narduk-enterprises/narduk-shell': '0.3.0',
          nuxt: '4.5.2',
        },
        devDependencies: {
          '@narduk-enterprises/eslint-config': '2.0.3',
          '@narduk-enterprises/narduk-testkit': '1.3.2',
        },
      })
      writeFile(root, 'apps/web/nuxt.config.ts', 'export default defineNuxtConfig({})\n')
      writeFile(root, 'apps/web/app/pages/index.vue', '<template><div /></template>\n')
      // The real plugin: defineNitroPlugin + registerHealthCheck, no logging.
      writeFile(
        root,
        'apps/web/server/plugins/health-checks.ts',
        [
          "import { registerHealthCheck } from '@narduk-enterprises/narduk-core/server/utils/health-checks'",
          'export default defineNitroPlugin(() => {',
          "  registerHealthCheck({ name: 'publication', required: true, timeoutMs: 30_000, async run() { return { detail: {} } } })",
          '})',
        ].join('\n'),
      )
      // Ordinary data routes under server/api -- none of them is /api/health.
      writeFile(
        root,
        'apps/web/server/api/stations/index.get.ts',
        'export default defineEventHandler(() => [])\n',
      )
      // PostHog named in configuration, never imported as an SDK.
      writeFile(
        root,
        'apps/web/app/utils/analytics.ts',
        [
          'export const analyticsConfig = {',
          "  posthogApiHost: 'https://p.nard.uk',",
          '  posthogPublicKey: process.env.POSTHOG_PUBLIC_KEY,',
          '}',
        ].join('\n'),
      )
      // A built Nitro bundle inlines every dependency; the walk must not see it.
      writeFile(
        root,
        'apps/web/.output/server/chunks/nitro/nitro.mjs',
        [
          'function createLogger(o){return{info:(m)=>console.log(m)}}',
          "import posthog from 'posthog-js'",
          'const useSeo=()=>{};const defaultSocialMeta={}',
        ].join('\n'),
      )
      writeFile(
        root,
        'apps/web/.output/server/chunks/routes/api/health.get.mjs',
        "export default defineEventHandler(() => ({ status: 'ok' }))\n",
      )
    })

    expect(artefact.detections).toEqual([])
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
    expect(artefact.inventory.dependencies).toHaveLength(8)
    expect(artefact.inventory.unclassified).toEqual([])
    // Proof the build tree was skipped rather than simply absent.
    expect(artefact.scan.files).toBe(4)
  })

  it('passes a freshly generated create-narduk-app scaffold shape', () => {
    const artefact = run((root) => {
      writeJson(root, 'package.json', {
        name: 'coverage-probe',
        devDependencies: { '@narduk-enterprises/narduk-app-tools': '0.4.2' },
      })
      writeJson(root, 'apps/web/package.json', {
        name: '@coverage-probe/web',
        dependencies: {
          '@narduk-enterprises/narduk-analytics': '1.19.36',
          '@narduk-enterprises/narduk-auth': '1.27.1',
          '@narduk-enterprises/narduk-core': '2.0.0',
          '@narduk-enterprises/narduk-logging': '0.1.0',
          '@narduk-enterprises/narduk-seo': '2.2.0',
          '@narduk-enterprises/narduk-shell': '0.3.0',
          '@narduk-enterprises/narduk-uploads': '1.20.0',
          nuxt: '4.5.2',
        },
        devDependencies: {
          '@narduk-enterprises/eslint-config': '2.0.3',
          '@narduk-enterprises/narduk-testkit': '1.3.2',
        },
      })
      writeFile(root, 'apps/web/nuxt.config.ts', 'export default defineNuxtConfig({})\n')
      writeFile(root, 'apps/web/app/app.config.ts', 'export default defineAppConfig({})\n')
      writeFile(root, 'apps/web/app/app.vue', '<template><NuxtPage /></template>\n')
      writeFile(root, 'apps/web/app/pages/index.vue', '<template><div /></template>\n')
      writeFile(root, 'apps/web/server/database/schema.ts', 'export const records = {}\n')
      writeFile(root, 'apps/web/server/utils/database.ts', 'export const useDb = () => undefined\n')
      writeFile(
        root,
        'apps/web/scripts/validate-manifests.mjs',
        "console.log('[manifests] ok')\nprocess.exit(0)\n",
      )
      writeFile(
        root,
        'scripts/package-registry-auth.mjs',
        "console.log('[registry-auth] configured')\n",
      )
    })

    expect(artefact.detections).toEqual([])
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
    // No server/api and no server/plugins in the scaffold: both are N/A, not a
    // guessed pass.
    const byId = new Map(artefact.item.checks.map((c) => [c.id, c.status]))
    expect(byId.get('9.6')).toBe('not-applicable')
    expect(byId.get('9.7')).toBe('not-applicable')
    expect(byId.get('9.3')).toBe('pass')
    expect(byId.get('9.4')).toBe('pass')
    expect(byId.get('9.5')).toBe('pass')
    expect(byId.get('9.8')).toBe('pass')
  })
})
