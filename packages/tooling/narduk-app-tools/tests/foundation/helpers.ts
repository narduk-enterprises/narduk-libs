import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type {
  RegistryPublication,
  RegistryReality,
  ResolvedVersion,
} from '../../src/foundation/npm-registry.js'
import type {
  FoundationCheckArtefact,
  FoundationItemResult,
  FoundationStatus,
} from '../../src/foundation/types.js'

export function makeTempRepo(): string {
  return mkdtempSync(join(tmpdir(), 'foundation-check-fixture-'))
}

export function writeFile(root: string, rel: string, content: string): void {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

export function writeJson(root: string, rel: string, value: unknown): void {
  writeFile(root, rel, JSON.stringify(value, null, 2))
}

/** A conformant baseline: item 1-6 all pass or not-applicable, item 7 always
 * not-applicable. Tests mutate ONE fact away from this baseline per case, so
 * every assertion is "this exact change flips this exact status" in both
 * directions. */
export function writeConformantBaseline(root: string): void {
  writeJson(root, 'package.json', {
    name: 'fixture-app',
    scripts: { 'manifests:validate': 'true' },
    dependencies: {
      '@narduk-enterprises/narduk-core': '3.4.1',
      '@narduk-enterprises/narduk-testkit': '2.0.0',
      '@narduk-enterprises/narduk-app-tools': '0.1.3',
      '@narduk-enterprises/eslint-config': '2.0.0',
      '@narduk-enterprises/narduk-seo': '1.0.0',
      '@narduk-enterprises/narduk-analytics': '1.0.0',
    },
  })
  writeJson(root, 'Config/cloudflare-app.json', {
    schemaVersion: 1,
    product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
    worker: { nitroPreset: 'cloudflare_module' },
    access: { exposureClass: 'public' },
    bindings: { r2: [] },
  })
  writeJson(root, 'wrangler.json', { workers_dev: true, preview_urls: true })
  writeFile(
    root,
    '.github/workflows/ci.yml',
    [
      'name: ci',
      'jobs:',
      '  build:',
      '    uses: narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@v1',
    ].join('\n'),
  )
  writeJson(root, 'renovate.json', {
    packageRules: [{ matchPackagePrefixes: ['@narduk-enterprises/'], groupName: 'estate' }],
  })
}

export function fakeReality(
  overrides: {
    installed?: Record<string, ResolvedVersion | null>
    latestMajors?: Record<string, number | null>
    publications?: Record<string, RegistryPublication>
  } = {},
): RegistryReality {
  const installed = overrides.installed ?? {}
  const latestMajors = overrides.latestMajors ?? {}
  const publications = overrides.publications ?? {}
  return {
    resolveInstalled(pkgName) {
      return pkgName in installed ? installed[pkgName] : null
    },
    async publicationOf(pkgName) {
      if (pkgName in publications) return publications[pkgName]
      if (pkgName in latestMajors) {
        const major = latestMajors[pkgName]
        if (major === null) return { status: 'unreadable' }
        return { status: 'published', latest: `${major}.0.0`, major }
      }
      return { status: 'unreadable' }
    },
    async latestPublishedMajor(pkgName) {
      if (pkgName in publications) {
        const publication = publications[pkgName]
        return publication.status === 'published' ? publication.major : null
      }
      return pkgName in latestMajors ? latestMajors[pkgName] : null
    },
  }
}

export const CONFORMANT_REALITY = fakeReality({
  installed: {
    '@narduk-enterprises/narduk-core': { version: '3.4.1', major: 3, source: 'manifest-pin' },
    '@narduk-enterprises/eslint-config': { version: '2.0.0', major: 2, source: 'manifest-pin' },
  },
  latestMajors: { '@narduk-enterprises/narduk-core': 3 },
})

export function itemStatus(artefact: FoundationCheckArtefact, id: number): FoundationStatus {
  const item = artefact.items.find((it: FoundationItemResult) => it.id === id)
  if (!item) throw new Error(`no item ${id} in artefact`)
  return item.status
}

export function subCheckStatus(artefact: FoundationCheckArtefact, subId: string): FoundationStatus {
  for (const item of artefact.items) {
    const sub = item.checks.find((c) => c.id === subId)
    if (sub) return sub.status
  }
  throw new Error(`no sub-check ${subId} in artefact`)
}
