import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

// narduk-core's own verifier: a hash this package writes must verify there,
// or the seeded admin cannot sign in (the two PBKDF2 copies would have drifted).
import { verifyUserPassword } from '../../../modules/narduk-core/runtime/server/utils/password'
import {
  DEFAULT_E2E_ADMIN_EMAIL,
  buildSeedAdminSql,
  buildVerifyAdminSql,
  ensureE2eAdminPassword,
  hashE2eAdminPassword,
  parseSeedAdminArgs,
  readCountFromWranglerJson,
  resolveE2eAdminEmail,
  runSeedAdminCommand,
  type SeedAdminDeps,
} from '../src/e2e/admin-credential.js'

const VERIFIED_JSON = JSON.stringify([{ results: [{ n: 1 }], success: true, meta: {} }])

function fakeDeps(env: NodeJS.ProcessEnv, verifyStdout = VERIFIED_JSON) {
  const calls: Array<{ args: string[]; fileContents?: string }> = []
  const errors: string[] = []
  const logs: string[] = []
  const deps: SeedAdminDeps = {
    cwd: '/app/web',
    env,
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    hash: async () => 'aa:bb',
    wrangler: (args) => {
      const fileIndex = args.indexOf('--file')
      const file = fileIndex === -1 ? undefined : args[fileIndex + 1]
      calls.push({ args: [...args], fileContents: file ? readFileSync(file, 'utf8') : undefined })
      return { status: 0, stdout: args.includes('--json') ? verifyStdout : '', stderr: '' }
    },
  }
  return { deps, calls, errors, logs }
}

describe('ensureE2eAdminPassword', () => {
  it('keeps a password the environment already set', () => {
    const env: NodeJS.ProcessEnv = { E2E_ADMIN_PASSWORD: 'supplied' }
    expect(ensureE2eAdminPassword(env)).toBe('supplied')
    expect(env.E2E_ADMIN_PASSWORD).toBe('supplied')
  })

  it('generates a random password once and stores it in the environment', () => {
    const env: NodeJS.ProcessEnv = {}
    const first = ensureE2eAdminPassword(env)
    expect(first).toMatch(/^[\w-]{32}$/)
    expect(env.E2E_ADMIN_PASSWORD).toBe(first)
    expect(ensureE2eAdminPassword(env)).toBe(first)
    expect(ensureE2eAdminPassword({})).not.toBe(first)
  })
})

describe('resolveE2eAdminEmail', () => {
  it('defaults to the core seed admin and honours E2E_ADMIN_EMAIL', () => {
    expect(resolveE2eAdminEmail({})).toBe(DEFAULT_E2E_ADMIN_EMAIL)
    expect(resolveE2eAdminEmail({ E2E_ADMIN_EMAIL: 'ops@example.com' })).toBe('ops@example.com')
  })
})

describe('hashE2eAdminPassword', () => {
  it("writes a hash narduk-core's verifyUserPassword accepts", async () => {
    const hash = await hashE2eAdminPassword('per-run-secret')
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/)
    await expect(verifyUserPassword('per-run-secret', hash)).resolves.toBe(true)
    await expect(verifyUserPassword('wrong', hash)).resolves.toBe(false)
  })

  it('salts every hash', async () => {
    expect(await hashE2eAdminPassword('same')).not.toBe(await hashE2eAdminPassword('same'))
  })
})

describe('parseSeedAdminArgs', () => {
  it('requires --local', () => {
    expect(() => parseSeedAdminArgs(['--database', 'app-db'])).toThrow('requires --local')
  })

  it.each([['--remote'], ['--preview']])('refuses %s even next to --local', (flag) => {
    expect(() => parseSeedAdminArgs(['--database', 'app-db', '--local', flag])).toThrow(
      `refuses ${flag}`,
    )
  })

  it('refuses --local=false and unknown flags', () => {
    expect(() => parseSeedAdminArgs(['--database', 'app-db', '--local=false'])).toThrow(
      'only runs against local',
    )
    expect(() =>
      parseSeedAdminArgs(['--database', 'app-db', '--local', '--env', 'production']),
    ).toThrow('Unknown seed-admin argument: --env')
  })

  it('needs a plain database name', () => {
    expect(() => parseSeedAdminArgs(['--local'])).toThrow('--database')
    expect(() => parseSeedAdminArgs(['--local', '--database', "db'; DROP"])).toThrow(
      'unusual database',
    )
  })

  it('reads the optional flags in both spellings', () => {
    expect(
      parseSeedAdminArgs([
        '--database=app-db',
        '--local',
        '--config',
        'wrangler.test.jsonc',
        '--persist-to=.wrangler/state',
        '--email',
        'ops@example.com',
      ]),
    ).toEqual({
      database: 'app-db',
      config: 'wrangler.test.jsonc',
      persistTo: '.wrangler/state',
      email: 'ops@example.com',
    })
  })
})

describe('seed SQL', () => {
  it('updates only the admin row and validates its inputs', () => {
    expect(buildSeedAdminSql('admin@example.com', 'ab:cd')).toBe(
      "UPDATE users SET password_hash = 'ab:cd' WHERE email = 'admin@example.com' AND is_admin = 1;\n",
    )
    expect(() => buildSeedAdminSql("x'@example.com", 'ab:cd')).toThrow('unusual admin email')
    expect(() => buildSeedAdminSql('admin@example.com', "ab:cd'")).toThrow('salt:hash')
    expect(buildVerifyAdminSql('admin@example.com')).toContain('password_hash IS NOT NULL')
  })

  it('reads the count from wrangler --json output, with or without a banner', () => {
    expect(readCountFromWranglerJson(VERIFIED_JSON)).toBe(1)
    expect(readCountFromWranglerJson(`wrangler banner\n${VERIFIED_JSON}`)).toBe(1)
    expect(readCountFromWranglerJson('not json')).toBeUndefined()
  })
})

describe('runSeedAdminCommand', () => {
  it('refuses without E2E_ADMIN_PASSWORD and never calls wrangler', async () => {
    const { deps, calls, errors } = fakeDeps({})
    expect(await runSeedAdminCommand(['--database', 'app-db', '--local'], deps)).toBe(1)
    expect(calls).toEqual([])
    expect(errors.join('\n')).toContain('ensureE2eAdminPassword')
  })

  it('refuses --remote and never calls wrangler', async () => {
    const { deps, calls } = fakeDeps({ E2E_ADMIN_PASSWORD: 'pw' })
    expect(await runSeedAdminCommand(['--database', 'app-db', '--local', '--remote'], deps)).toBe(1)
    expect(calls).toEqual([])
  })

  it('writes the hash through a temporary file with --local, then verifies the row', async () => {
    const { deps, calls, logs } = fakeDeps({ E2E_ADMIN_PASSWORD: 'never-on-argv' })
    const code = await runSeedAdminCommand(
      ['--database', 'app-db', '--local', '--config', 'wrangler.test.jsonc'],
      deps,
    )
    expect(code).toBe(0)
    expect(calls).toHaveLength(2)
    const [update, verify] = calls
    expect(update!.args.slice(0, 6)).toEqual([
      'd1',
      'execute',
      'app-db',
      '--local',
      '--config',
      'wrangler.test.jsonc',
    ])
    expect(update!.fileContents).toContain("SET password_hash = 'aa:bb'")
    const file = update!.args[update!.args.indexOf('--file') + 1]!
    expect(existsSync(file)).toBe(false)
    expect(verify!.args).toContain('--local')
    expect(verify!.args).toContain('--json')
    for (const call of calls) {
      expect(call.args.join(' ')).not.toContain('never-on-argv')
      expect(call.args).not.toContain('--remote')
    }
    expect(logs.join('\n')).not.toContain('never-on-argv')
  })

  it('fails when no admin row took the hash (core seed not applied)', async () => {
    const { deps, errors } = fakeDeps(
      { E2E_ADMIN_PASSWORD: 'pw' },
      JSON.stringify([{ results: [{ n: 0 }], success: true }]),
    )
    expect(await runSeedAdminCommand(['--database', 'app-db', '--local'], deps)).toBe(1)
    expect(errors.join('\n')).toContain('db:seed:core')
  })

  it('fails when wrangler fails', async () => {
    const { deps } = fakeDeps({ E2E_ADMIN_PASSWORD: 'pw' })
    deps.wrangler = vi.fn(() => ({ status: 1, stdout: '', stderr: 'no such table: users' }))
    expect(await runSeedAdminCommand(['--database', 'app-db', '--local'], deps)).toBe(1)
  })
})
