import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { main } from '../src/cli.js'
import {
  devSeedEnv,
  parseDevSeedArgs,
  planDevSeed,
  runDevSeed,
  type DevSeedExecutor,
} from '../src/dev-seed.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  vi.restoreAllMocks()
})

const WRANGLER = `{
  // generated app shape
  "name": "app",
  "d1_databases": [{ "binding": "DB", "database_name": "app", "database_id": "x" }],
  "kv_namespaces": [{ "binding": "CACHE", "id": "y" }],
  "r2_buckets": [{ "binding": "UPLOADS", "bucket_name": "app-uploads" }],
}
`

function app(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'narduk-dev-seed-'))
  dirs.push(root)
  for (const [rel, text] of Object.entries({ 'wrangler.jsonc': WRANGLER, ...files })) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  return root
}

const FIXTURES = {
  'seed/d1/DB/0002-rows.sql': "INSERT INTO t VALUES ('a');\n",
  'seed/d1/DB/0001-schema.sql': 'CREATE TABLE t (id TEXT);\n',
  'seed/d1/DB/README.md': 'not sql',
  'seed/kv/CACHE/flags.json': '[{"key":"k","value":"v"}]',
  'seed/r2/UPLOADS/images/b.png': 'png',
  'seed/r2/UPLOADS/a.txt': 'a',
}

describe('planDevSeed', () => {
  it('plans d1 in file order, then kv, then r2 keyed by path, all --local', () => {
    const root = app(FIXTURES)
    const plan = planDevSeed(parseDevSeedArgs([], root))
    expect(plan.wranglerConfig).toBe('wrangler.jsonc')
    expect(plan.steps.map((step) => `${step.kind} ${step.binding} ${step.file}`)).toEqual([
      'd1 DB seed/d1/DB/0001-schema.sql',
      'd1 DB seed/d1/DB/0002-rows.sql',
      'kv CACHE seed/kv/CACHE/flags.json',
      'r2 UPLOADS seed/r2/UPLOADS/a.txt',
      'r2 UPLOADS seed/r2/UPLOADS/images/b.png',
    ])
    for (const step of plan.steps) {
      expect(step.args).toContain('--local')
      expect(step.args).not.toContain('--remote')
    }
    expect(plan.steps[0]!.args.slice(0, 4)).toEqual([
      'd1',
      'execute',
      'DB',
      `--file=${join(root, 'seed/d1/DB/0001-schema.sql')}`,
    ])
    expect(plan.steps[2]!.args.slice(0, 6)).toEqual([
      'kv',
      'bulk',
      'put',
      join(root, 'seed/kv/CACHE/flags.json'),
      '--binding',
      'CACHE',
    ])
    // R2 addresses the bucket, not the binding.
    expect(plan.steps[4]!.args.slice(0, 4)).toEqual([
      'r2',
      'object',
      'put',
      'app-uploads/images/b.png',
    ])
    expect(plan.resetPaths).toEqual([])
  })

  it('passes --persist-to and resets only the kinds it seeds', () => {
    const root = app({ 'seed/d1/DB/0001.sql': 'SELECT 1;' })
    const plan = planDevSeed(parseDevSeedArgs(['--persist-to', 'state', '--reset'], root))
    expect(plan.steps[0]!.args).toEqual(
      expect.arrayContaining(['--persist-to', join(root, 'state')]),
    )
    expect(plan.resetPaths).toEqual([join(root, 'state', 'v3', 'd1')])
  })

  it('refuses a fixture directory for a binding wrangler does not declare', () => {
    const root = app({ 'seed/d1/OLD_DB/0001.sql': 'SELECT 1;' })
    expect(() => planDevSeed(parseDevSeedArgs([], root))).toThrow(
      'seed/d1/OLD_DB names no d1 binding in the wrangler config (declared: DB)',
    )
    const r2 = app({ 'seed/r2/FILES/a.txt': 'a' })
    expect(() => planDevSeed(parseDevSeedArgs([], r2))).toThrow('(declared: UPLOADS)')
  })

  it('fails without fixtures, without a wrangler config, and on a TOML config', () => {
    expect(() => planDevSeed(parseDevSeedArgs([], app({})))).toThrow(
      'fixture directory seed does not exist',
    )
    expect(() => planDevSeed(parseDevSeedArgs([], app({ 'seed/.keep': '' })))).toThrow(
      'holds no fixtures',
    )
    const bare = mkdtempSync(join(tmpdir(), 'narduk-dev-seed-'))
    dirs.push(bare)
    expect(() => planDevSeed(parseDevSeedArgs([], bare))).toThrow(
      'no wrangler.jsonc or wrangler.json',
    )
    const toml = app({ 'wrangler.toml': 'name = "app"\n', 'seed/d1/DB/1.sql': '' })
    expect(() => planDevSeed(parseDevSeedArgs(['--config', 'wrangler.toml'], toml))).toThrow(
      'is TOML',
    )
  })
})

describe('runDevSeed', () => {
  it('runs every step with the Cloudflare credentials stripped', () => {
    const root = app(FIXTURES)
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = []
    const executor: DevSeedExecutor = (args, _cwd, env) => {
      calls.push({ args, env })
    }
    runDevSeed(parseDevSeedArgs([], root), executor, {
      PATH: '/bin',
      CLOUDFLARE_API_TOKEN: 'secret',
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CF_API_TOKEN: 'secret',
    })
    expect(calls).toHaveLength(5)
    for (const { env } of calls) {
      expect(env).toEqual({ PATH: '/bin' })
    }
  })

  it('names the fixture that failed', () => {
    const root = app(FIXTURES)
    const executor: DevSeedExecutor = (args) => {
      if (args[0] === 'kv') throw new Error('boom')
    }
    expect(() => runDevSeed(parseDevSeedArgs([], root), executor, {})).toThrow(
      'dev:seed: kv CACHE seed/kv/CACHE/flags.json failed: boom',
    )
  })

  it('runs nothing on --dry-run', () => {
    const root = app(FIXTURES)
    const executor = vi.fn()
    const plan = runDevSeed(parseDevSeedArgs(['--dry-run', '--reset'], root), executor, {})
    expect(executor).not.toHaveBeenCalled()
    expect(plan.resetPaths).toHaveLength(3)
  })

  it('devSeedEnv leaves unrelated variables alone', () => {
    expect(devSeedEnv({ HOME: '/h', CLOUDFLARE_EMAIL: 'x' })).toEqual({ HOME: '/h' })
  })
})

describe('narduk-app dev:seed', () => {
  it('prints the dry-run plan and rejects unknown flags', async () => {
    const root = app(FIXTURES)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await main(['dev:seed', '--cwd', root, '--dry-run'])).toBe(0)
    expect(log.mock.calls.flat().join('\n')).toContain(
      'would seed local state from seed (d1 2, kv 1, r2 2)',
    )
    expect(await main(['dev:seed', '--remote'])).toBe(1)
    expect(error.mock.calls.flat().join('\n')).toContain('Unknown dev:seed option: --remote')
  })
})
