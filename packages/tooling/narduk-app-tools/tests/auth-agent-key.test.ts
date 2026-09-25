import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AGENT_KEY_PROOF_PATH,
  buildAgentKeySql,
  defaultAgentKeyDependencies,
  formatAgentKeyCreateResult,
  mintAgentKey,
  parseAgentKeyCreateArgs,
  runAgentKeyCreate,
  type AgentKeyDependencies,
  type AgentKeyFetch,
} from '../src/auth-agent-key.js'
import { wranglerJson } from './wrangler-d1-fake.js'

const CORE_MIGRATIONS = join(import.meta.dirname, '../../../modules/narduk-core/runtime/drizzle')

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
  vi.restoreAllMocks()
})

/** A D1 with narduk-core's real users / api_keys migrations applied. */
function coreDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  cleanup.push(() => db.close())
  for (const file of readdirSync(CORE_MIGRATIONS)
    .filter((name) => /^\d{4}_.*\.sql$/u.test(name))
    .sort()) {
    db.exec(readFileSync(join(CORE_MIGRATIONS, file), 'utf8'))
  }
  return db
}

const BASE_ARGS = [
  '--database',
  'APP_DB',
  '--local',
  '--name',
  'loadtest agent',
  '--scopes',
  'auth:api-keys:read, farm:read',
  '--expires-days',
  '30',
]

/**
 * The app side of the proof: narduk-core's api-key auth over the same D1 —
 * the sha256 of an `nk_` bearer must match a live, unexpired row; the route
 * then requires auth:api-keys:read.
 */
function appFetch(db: DatabaseSync): AgentKeyFetch {
  return async (url, init) => {
    expect(url).toBe(`https://app.example${AGENT_KEY_PROOF_PATH}`)
    const header = init.headers.authorization
    const raw = header?.startsWith('Bearer nk_') ? header.slice(7) : null
    const row = raw
      ? (db
          .prepare(
            'SELECT scopes_json FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL AND expires_at > ?',
          )
          .get(createHash('sha256').update(raw).digest('hex'), Math.floor(Date.now() / 1000)) as
          { scopes_json: string } | undefined)
      : undefined
    if (!row) return { status: 401, text: async () => 'Unauthorized' }
    if (!(JSON.parse(row.scopes_json) as string[]).includes('auth:api-keys:read')) {
      return {
        status: 403,
        text: async () =>
          '{"message":"Forbidden — missing required API key scopes: auth:api-keys:read"}',
      }
    }
    return { status: 200, text: async () => '[]' }
  }
}

function dependencies(
  db: DatabaseSync,
  overrides: Partial<AgentKeyDependencies> = {},
): AgentKeyDependencies & { sinkInputs: string[]; d1Args: string[][] } {
  const sinkInputs: string[] = []
  const d1Args: string[][] = []
  return {
    sinkInputs,
    d1Args,
    executeD1: (args) => {
      d1Args.push(args)
      return wranglerJson(db, args[args.indexOf('--command') + 1]!)
    },
    fetch: appFetch(db),
    mint: mintAgentKey,
    now: () => new Date(),
    runSink: (_command, _args, input) => {
      sinkInputs.push(input)
      return { status: 0 }
    },
    ...overrides,
  }
}

describe('narduk-app auth agent-key create (#782)', () => {
  it('parses the command and requires a sink, scopes and a proof choice', () => {
    const flags = parseAgentKeyCreateArgs(
      [...BASE_ARGS, '--admin', '--app-url', 'https://app.example/x', '--', 'sink', '-p', 'app'],
      '/repo',
    )
    expect(flags).toMatchObject({
      admin: true,
      appUrl: 'https://app.example',
      database: 'APP_DB',
      expiresDays: 30,
      location: '--local',
      name: 'loadtest agent',
      scopes: ['auth:api-keys:read', 'farm:read'],
      sink: { command: 'sink', args: ['-p', 'app'] },
    })
    expect(() => parseAgentKeyCreateArgs([...BASE_ARGS, '--no-proof'])).toThrow(/secret sink/u)
    expect(() => parseAgentKeyCreateArgs([...BASE_ARGS, '--', 'sink'])).toThrow(/--app-url/u)
    expect(() =>
      parseAgentKeyCreateArgs([...BASE_ARGS, '--no-proof', '--scopes', ' , ', '--', 'sink']),
    ).toThrow(/at least one scope/u)
    expect(() =>
      parseAgentKeyCreateArgs([...BASE_ARGS, '--remote', '--no-proof', '--', 'sink']),
    ).toThrow(/exactly one of --local or --remote/u)
    expect(() =>
      parseAgentKeyCreateArgs([...BASE_ARGS, '--app-url', 'http://app.example', '--', 'sink']),
    ).toThrow(/https/u)
  })

  it('writes the users timestamps hand SQL left out, which core requires', () => {
    const db = coreDatabase()
    // The loadtest.dev failure: users.created_at has no SQL default.
    expect(() =>
      db.exec("INSERT INTO users (id, email) VALUES ('u-1', 'hand@example.com')"),
    ).toThrow(/NOT NULL constraint failed: users.created_at/u)

    const sql = buildAgentKeySql(
      {
        createdAt: '2026-09-25T00:00:00.000Z',
        email: 'agent@agents.invalid',
        expiresAt: 1_900_000_000,
        keyId: 'k-1',
        keyPrefix: 'nk_12345678',
        name: "o'brien agent",
        scopes: ['farm:read'],
        userId: 'u-2',
      },
      'hash',
      false,
    )
    db.exec(sql)
    expect(db.prepare('SELECT * FROM users WHERE id = ?').get('u-2')).toMatchObject({
      created_at: '2026-09-25T00:00:00.000Z',
      updated_at: '2026-09-25T00:00:00.000Z',
      password_hash: null,
      name: "o'brien agent",
      is_admin: 0,
    })
    expect(db.prepare('SELECT * FROM api_keys WHERE id = ?').get('k-1')).toMatchObject({
      created_at: '2026-09-25T00:00:00.000Z',
      scopes_json: '["farm:read"]',
      revoked_at: null,
    })
  })

  it('creates a non-login user and a key the app authenticates, and proves it', async () => {
    const db = coreDatabase()
    const deps = dependencies(db)
    const log = vi.spyOn(console, 'log')
    const result = await runAgentKeyCreate(
      parseAgentKeyCreateArgs([...BASE_ARGS, '--app-url', 'https://app.example', '--', 'sink']),
      deps,
    )

    const [rawKey] = deps.sinkInputs
    expect(rawKey).toMatch(/^nk_[0-9a-f]{64}$/u)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.userId) as Record<
      string,
      unknown
    >
    expect(user).toMatchObject({ password_hash: null, is_admin: 0, email: result.email })
    expect(result.email).toMatch(/^agent-loadtest-agent-[0-9a-f]{8}@agents\.invalid$/u)
    const key = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(result.keyId) as Record<
      string,
      unknown
    >
    expect(key).toMatchObject({
      user_id: result.userId,
      key_hash: createHash('sha256').update(rawKey!).digest('hex'),
      key_prefix: rawKey!.slice(0, 11),
      scopes_json: '["auth:api-keys:read","farm:read"]',
    })
    expect(result.proof).toEqual({
      anonymousStatus: 401,
      keyStatus: 200,
      url: `https://app.example${AGENT_KEY_PROOF_PATH}`,
    })

    // The value reaches neither D1's argv nor anything printed.
    expect(deps.d1Args.flat().join(' ')).not.toContain(rawKey)
    const printed = formatAgentKeyCreateResult(result)
    expect(printed).not.toContain(rawKey)
    expect(JSON.stringify(result)).not.toContain(rawKey)
    expect(log).not.toHaveBeenCalled()
  })

  it('accepts a 403 missing-scope answer as proof for a key without auth:api-keys:read', async () => {
    const db = coreDatabase()
    const result = await runAgentKeyCreate(
      parseAgentKeyCreateArgs([
        ...BASE_ARGS,
        '--scopes',
        'farm:read',
        '--app-url',
        'https://app.example',
        '--',
        'sink',
      ]),
      dependencies(db),
    )
    expect(result.proof).toMatchObject({ anonymousStatus: 401, keyStatus: 403 })
  })

  it('fails the proof when the app does not know the key', async () => {
    const db = coreDatabase()
    const other = coreDatabase()
    await expect(
      runAgentKeyCreate(
        parseAgentKeyCreateArgs([...BASE_ARGS, '--app-url', 'https://app.example', '--', 'sink']),
        dependencies(db, { fetch: appFetch(other) }),
      ),
    ).rejects.toThrow(/proof failed: .* 401 without the key .* 401 with it/u)
  })

  it('writes nothing to D1 when the sink fails', async () => {
    const db = coreDatabase()
    const deps = dependencies(db, { runSink: () => ({ status: 3 }) })
    await expect(
      runAgentKeyCreate(parseAgentKeyCreateArgs([...BASE_ARGS, '--no-proof', '--', 'sink']), deps),
    ).rejects.toThrow(/sink `sink` failed \(exit 3\); nothing was written to D1/u)
    expect(deps.d1Args).toEqual([])
    expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 })
  })

  it('refuses an --email that already belongs to a user, adding nothing', async () => {
    const db = coreDatabase()
    db.exec(
      "INSERT INTO users (id, email, created_at, updated_at) VALUES ('owner', 'owner@example.com', 'x', 'x')",
    )
    await expect(
      runAgentKeyCreate(
        parseAgentKeyCreateArgs([
          ...BASE_ARGS,
          '--email',
          'Owner@Example.com',
          '--no-proof',
          '--',
          'sink',
        ]),
        dependencies(db),
      ),
    ).rejects.toThrow(/D1 refused .* not live/u)
    expect(db.prepare('SELECT count(*) AS n FROM api_keys').get()).toEqual({ n: 0 })
  })

  it('hands the key to a real sink process on stdin only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-key-sink-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const out = join(dir, 'received')
    const db = coreDatabase()
    const deps = dependencies(db, { runSink: defaultAgentKeyDependencies.runSink })
    const sinkArgs = [
      '-e',
      'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>require("fs").writeFileSync(process.argv[1],JSON.stringify({s,argv:process.argv})))',
      out,
    ]
    const result = await runAgentKeyCreate(
      parseAgentKeyCreateArgs([...BASE_ARGS, '--no-proof', '--', process.execPath, ...sinkArgs]),
      deps,
    )
    const received = JSON.parse(readFileSync(out, 'utf8')) as { argv: string[]; s: string }
    expect(received.s).toMatch(/^nk_[0-9a-f]{64}$/u)
    expect(received.argv.join(' ')).not.toContain(received.s)
    const key = db.prepare('SELECT key_hash FROM api_keys WHERE id = ?').get(result.keyId)
    expect(key).toEqual({ key_hash: createHash('sha256').update(received.s).digest('hex') })
    expect(result.proof).toBe('skipped')
  })
})
