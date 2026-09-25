import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { main } from '../src/cli.js'
import {
  parseManifestsValidateArgs,
  validateCloudflareManifest,
  wranglerFactsFromJson,
  wranglerFactsFromToml,
} from '../src/manifests-validate.js'

const ACCOUNT = '0123456789abcdef0123456789abcdef'
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  vi.restoreAllMocks()
})

function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'narduk-manifests-'))
  dirs.push(root)
  const all = { 'package.json': '{"name":"fixture","private":true}\n', ...files }
  for (const [rel, text] of Object.entries(all)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  return root
}

function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    worker: {
      name: 'app',
      wranglerConfig: 'apps/web/wrangler.jsonc',
      workersDev: false,
      previewUrls: false,
    },
    bindings: {
      d1: [{ binding: 'DB' }],
      kv: [],
      r2: [{ binding: 'UPLOADS' }],
      queues: [
        { binding: 'JOBS', role: 'producer' },
        { queue: 'jobs', role: 'consumer' },
      ],
      cron: ['0 * * * *', '*/15 * * * *'],
    },
    deployment: { accountId: ACCOUNT },
    ...overrides,
  })
}

// The generator's wrangler.jsonc shape: comments, a trailing comma, a "**/*.mjs"
// string and a "*/15" cron (the #914 regex-stripper crash), plus a URL whose
// `//` a line-comment regex would eat.
const WRANGLER_JSONC = `{
  // Worker config
  "name": "app",
  "account_id": "${ACCOUNT}",
  "workers_dev": false,
  "preview_urls": false,
  "rules": [{ "type": "ESModule", "globs": ["**/*.mjs"] }],
  "vars": { "SITE_URL": "https://example.com/path" },
  /* bindings */
  "d1_databases": [{ "binding": "DB", "database_name": "app", "database_id": "x" }],
  "r2_buckets": [{ "binding": "UPLOADS", "bucket_name": "u" }],
  "queues": {
    "producers": [{ "binding": "JOBS", "queue": "jobs" }],
    "consumers": [{ "queue": "jobs" }],
  },
  "triggers": { "crons": ["*/15 * * * *", "0 * * * *"] },
}
`

describe('validateCloudflareManifest', () => {
  it('agrees when crons differ only in order and JSONC carries tricky strings', () => {
    const root = checkout({
      'Config/cloudflare-app.json': manifest(),
      'apps/web/wrangler.jsonc': WRANGLER_JSONC,
    })
    const result = validateCloudflareManifest(root)
    expect(result.wranglerConfigs).toEqual(['apps/web/wrangler.jsonc'])
    expect(result.findings).toEqual([])
  })

  it('names a binding missing on either side', () => {
    const root = checkout({
      'Config/cloudflare-app.json': manifest(),
      'apps/web/wrangler.jsonc': WRANGLER_JSONC.replace(
        '"binding": "UPLOADS"',
        '"binding": "FILES"',
      ),
    })
    const [finding, ...rest] = validateCloudflareManifest(root).findings
    expect(rest).toEqual([])
    expect(finding).toMatchObject({ file: 'apps/web/wrangler.jsonc', field: 'bindings.r2' })
    expect(finding.message).toContain('missing from wrangler: UPLOADS')
    expect(finding.message).toContain('not in the manifest: FILES')
  })

  it('requires the manifest account in wrangler, and says when it is absent', () => {
    const root = checkout({
      'Config/cloudflare-app.json': manifest(),
      'apps/web/wrangler.jsonc': WRANGLER_JSONC.replace(`"account_id": "${ACCOUNT}",`, ''),
    })
    expect(validateCloudflareManifest(root).findings).toEqual([
      expect.objectContaining({
        field: 'account_id',
        message: expect.stringContaining('declares no account_id'),
      }),
    ])
  })

  it('does not require account_id when the manifest declares none', () => {
    const root = checkout({
      'Config/cloudflare-app.json': manifest({ deployment: undefined }),
      'apps/web/wrangler.jsonc': WRANGLER_JSONC.replace(`"account_id": "${ACCOUNT}",`, ''),
    })
    expect(validateCloudflareManifest(root).findings).toEqual([])
  })

  it('reports a flipped or undeclared access flag', () => {
    const root = checkout({
      'Config/cloudflare-app.json': manifest(),
      'apps/web/wrangler.jsonc': WRANGLER_JSONC.replace(
        '"workers_dev": false,',
        '"workers_dev": true,',
      ).replace('"preview_urls": false,', ''),
    })
    const fields = validateCloudflareManifest(root).findings.map((f) => [f.field, f.message])
    expect(fields).toEqual([
      ['workers_dev', "wrangler workers_dev is true; the manifest's worker.workersDev is false"],
      [
        'preview_urls',
        "wrangler does not declare preview_urls; the manifest's worker.previewUrls is false",
      ],
    ])
  })

  it('compares only the binding kinds the manifest declares', () => {
    const root = checkout({
      'Config/cloudflare-app.json': JSON.stringify({
        worker: { wranglerConfig: 'apps/web/wrangler.jsonc' },
        bindings: { d1: ['DB'] },
      }),
      'apps/web/wrangler.jsonc': WRANGLER_JSONC,
    })
    expect(validateCloudflareManifest(root).findings).toEqual([])
  })

  it('fails a missing manifest, a missing wrangler config, and invalid JSONC', () => {
    expect(validateCloudflareManifest(checkout({})).findings[0]?.message).toContain(
      'does not exist',
    )
    const missing = checkout({ 'Config/cloudflare-app.json': manifest() })
    expect(validateCloudflareManifest(missing).findings[0]).toMatchObject({
      file: 'apps/web/wrangler.jsonc',
      message: 'apps/web/wrangler.jsonc does not exist',
    })
    const broken = checkout({
      'Config/cloudflare-app.json': manifest(),
      'apps/web/wrangler.jsonc': '{ "name": ',
    })
    expect(validateCloudflareManifest(broken).findings[0]?.message).toContain(
      'not valid JSON/JSONC',
    )
  })

  it('compares every --wrangler path given, e.g. a staging config', () => {
    const root = checkout({
      'Config/cloudflare-app.json': manifest(),
      'apps/web/wrangler.jsonc': WRANGLER_JSONC,
      'apps/web/wrangler.staging.jsonc': WRANGLER_JSONC.replace('"0 * * * *"', '"5 * * * *"'),
    })
    const result = validateCloudflareManifest(root, {
      wranglerPaths: ['apps/web/wrangler.jsonc', join(root, 'apps/web/wrangler.staging.jsonc')],
    })
    expect(result.wranglerConfigs).toEqual([
      'apps/web/wrangler.jsonc',
      'apps/web/wrangler.staging.jsonc',
    ])
    expect(result.findings.map((f) => `${f.file} ${f.field}`)).toEqual([
      'apps/web/wrangler.staging.jsonc bindings.cron',
    ])
  })

  it('falls back to a wrangler config at a known path when the manifest names none', () => {
    const root = checkout({
      'Config/cloudflare-app.json': manifest({ worker: { workersDev: false, previewUrls: false } }),
      'wrangler.jsonc': WRANGLER_JSONC,
    })
    const result = validateCloudflareManifest(root)
    expect(result.wranglerConfigs).toEqual(['wrangler.jsonc'])
    expect(result.findings).toEqual([])
  })
})

describe('wrangler readers', () => {
  it('reads the same facts from TOML as from JSON, top level only', () => {
    const toml = `
name = "app"
account_id = "${ACCOUNT}" # production account
workers_dev = false
preview_urls = false

[vars]
SITE_URL = "https://example.com"

[[d1_databases]]
binding = "DB"
database_name = "app"

[[r2_buckets]]
binding = "UPLOADS"

[[queues.producers]]
binding = "JOBS"
queue = "jobs"

[[queues.consumers]]
queue = "jobs"

[[durable_objects.bindings]]
name = "ROOM"
class_name = "Room"

[triggers]
crons = [
  "*/15 * * * *",
  "0 * * * *",
]

[env.staging]
workers_dev = true

[[env.staging.d1_databases]]
binding = "STAGING_DB"
`
    const json = wranglerFactsFromJson({
      ...(JSON.parse(
        JSON.stringify({
          account_id: ACCOUNT,
          workers_dev: false,
          preview_urls: false,
          d1_databases: [{ binding: 'DB' }],
          r2_buckets: [{ binding: 'UPLOADS' }],
          queues: {
            producers: [{ binding: 'JOBS', queue: 'jobs' }],
            consumers: [{ queue: 'jobs' }],
          },
          durable_objects: { bindings: [{ name: 'ROOM', class_name: 'Room' }] },
          triggers: { crons: ['0 * * * *', '*/15 * * * *'] },
          env: { staging: { workers_dev: true, d1_databases: [{ binding: 'STAGING_DB' }] } },
        }),
      ) as object),
    })
    expect(wranglerFactsFromToml(toml)).toEqual(json)
    expect(json.durableObjects).toEqual(['ROOM'])
    expect(json.d1).toEqual(['DB'])
  })
})

describe('narduk-app manifests validate', () => {
  it('parses flags', () => {
    expect(
      parseManifestsValidateArgs(
        ['--checkout', 'app', '--wrangler', 'a.jsonc', '--wrangler', 'b.toml', '--json'],
        '/x',
      ),
    ).toEqual({
      checkoutDir: '/x/app',
      wranglerPaths: ['a.jsonc', 'b.toml'],
      json: true,
      jsonPath: null,
    })
    expect(() => parseManifestsValidateArgs(['--bogus'])).toThrow(
      'Unknown manifests validate option',
    )
  })

  it('exits 0 on agreement and 1 on a disagreement', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const good = checkout({
      'Config/cloudflare-app.json': manifest(),
      'apps/web/wrangler.jsonc': WRANGLER_JSONC,
    })
    expect(await main(['manifests', 'validate', '--checkout', good])).toBe(0)
    expect(log.mock.calls.flat().join('\n')).toContain('agree')

    const bad = checkout({
      'Config/cloudflare-app.json': manifest(),
      'apps/web/wrangler.jsonc': WRANGLER_JSONC.replace('"0 * * * *"', '"1 * * * *"'),
    })
    expect(await main(['manifests', 'validate', '--checkout', bad])).toBe(1)
    expect(error.mock.calls.flat().join('\n')).toContain('bindings.cron')
    expect(await main(['manifests', 'check'])).toBe(1)
  })
})
