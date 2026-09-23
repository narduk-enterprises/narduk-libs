import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { workerBundlingCheck } from '../src/doctor.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function wrangler(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'worker-bundling-'))
  dirs.push(dir)
  const path = join(dir, 'wrangler.jsonc')
  writeFileSync(path, text)
  return path
}

const COMPLIANT = `{
  // create-narduk-app's shape
  "main": "./.output/server/index.mjs",
  "no_bundle": true,
  "find_additional_modules": true,
  "base_dir": ".output/server",
  "rules": [{ "type": "ESModule", "globs": ["**/*.mjs"] }],
}`

describe('workerBundlingCheck (narduk-libs#245)', () => {
  it('passes the generated shape', () => {
    expect(workerBundlingCheck(wrangler(COMPLIANT)).status).toBe('pass')
  })

  it('warns, naming each missing field and the consequence, for Nitro output deployed bundled', () => {
    // LakeStat's shape on 2026-09-23: `main` alone.
    const check = workerBundlingCheck(wrangler('{ "main": ".output/server/index.mjs" }'))
    expect(check.status).toBe('warn')
    expect(check.detail).toContain('no_bundle, find_additional_modules, base_dir')
    expect(check.detail).toContain('404/500')
  })

  it('treats a false field as missing', () => {
    const check = workerBundlingCheck(
      wrangler(COMPLIANT.replace('"no_bundle": true', '"no_bundle": false')),
    )
    expect(check.status).toBe('warn')
    expect(check.detail).toContain('missing no_bundle,')
  })

  it('has nothing to say about a worker that is not Nitro output', () => {
    expect(workerBundlingCheck(wrangler('{ "main": "src/worker.ts" }')).status).toBe('pass')
    expect(workerBundlingCheck(wrangler('{ "name": "app" }')).status).toBe('pass')
  })

  it('fails on an unreadable config rather than passing it', () => {
    expect(workerBundlingCheck(wrangler('{ "main": ')).status).toBe('fail')
  })
})
