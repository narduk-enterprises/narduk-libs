import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { main } from '../src/cli.js'
import {
  buildWranglerD1CreateArgs,
  conventionalD1DatabaseName,
  parseD1CreateArgs,
  parseD1CreateOutput,
  PLACEHOLDER_D1_DATABASE_ID,
  planD1Create,
  runD1Create,
  withD1DatabaseId,
  type D1CreateExecutor,
} from '../src/d1-create.js'

const ACCOUNT = '0123456789abcdef0123456789abcdef'
const NEW_ID = 'f3b1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

/** What wrangler 4 prints for `d1 create` against a JSON config, with stdin
 * closed (the non-interactive fallback declines its own config edit). */
function wranglerOutput(name: string, id: string): string {
  return [
    `✅ Successfully created DB '${name}' in region WNAM`,
    'Created your new D1 database.',
    '',
    'To access your new D1 Database in your Worker, add the following snippet to your configuration file:',
    JSON.stringify(
      {
        d1_databases: [
          { binding: name.replaceAll('-', '_'), database_name: name, database_id: id },
        ],
      },
      null,
      2,
    ),
    '? Would you like Wrangler to add it on your behalf?',
    '🤖 Using fallback value in non-interactive context: no',
  ].join('\n')
}

const WRANGLER_JSONC = [
  '{',
  '  "$schema": "https://unpkg.com/wrangler@latest/config-schema.json",',
  '  "name": "harbor-notes",',
  '  // Rate limits: a comment the write must keep',
  '  "d1_databases": [',
  '    {',
  '      "binding": "DB",',
  '      "database_name": "harbor-notes-db",',
  `      "database_id": "${PLACEHOLDER_D1_DATABASE_ID}", // placeholder`,
  '      "migrations_dir": "drizzle",',
  '    },',
  '  ],',
  '}',
  '',
].join('\n')

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  vi.restoreAllMocks()
})

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text, 'utf8')
}

function manifest(overrides: { worker?: object; d1?: unknown[] } = {}): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      worker: {
        name: 'harbor-notes',
        wranglerConfig: 'apps/web/wrangler.jsonc',
        ...overrides.worker,
      },
      bindings: { d1: overrides.d1 ?? [{ binding: 'DB' }], r2: [] },
    },
    null,
    2,
  )
}

function checkout(options: { wrangler?: string; manifest?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'd1-create-'))
  tempDirs.push(root)
  write(root, 'package.json', '{ "name": "harbor-notes" }\n')
  write(root, 'Config/cloudflare-app.json', options.manifest ?? manifest())
  write(root, 'apps/web/wrangler.jsonc', options.wrangler ?? WRANGLER_JSONC)
  return root
}

const env = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT } as NodeJS.ProcessEnv

function recordingExecutor(output = wranglerOutput('harbor-notes-db', NEW_ID)) {
  const calls: Array<{ args: string[]; cwd: string; env: NodeJS.ProcessEnv }> = []
  const executor: D1CreateExecutor = (args, cwd, callEnv) => {
    calls.push({ args, cwd, env: callEnv })
    return output
  }
  return { calls, executor }
}

describe('db create', () => {
  it('creates the manifest-named database and writes its id, comments intact', () => {
    const root = checkout()
    const { calls, executor } = recordingExecutor()

    const result = runD1Create({ checkoutDir: root, env }, executor)

    expect(result).toEqual({
      status: 'created',
      binding: 'DB',
      databaseName: 'harbor-notes-db',
      databaseId: NEW_ID,
      accountId: ACCOUNT,
      accountSource: 'CLOUDFLARE_ACCOUNT_ID',
      wranglerConfig: 'apps/web/wrangler.jsonc',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.args).toEqual([
      'd1',
      'create',
      'harbor-notes-db',
      '--config',
      join(root, 'apps/web/wrangler.jsonc'),
    ])
    expect(calls[0]!.cwd).toBe(join(root, 'apps/web'))
    expect(calls[0]!.env.CLOUDFLARE_ACCOUNT_ID).toBe(ACCOUNT)
    // Exactly one token changed: the id. Every comment, trailing comma and
    // indent is the file as the generator wrote it.
    expect(readFileSync(join(root, 'apps/web/wrangler.jsonc'), 'utf8')).toBe(
      WRANGLER_JSONC.replace(PLACEHOLDER_D1_DATABASE_ID, NEW_ID),
    )
  })

  it('refuses a binding that already names a real database, without calling wrangler', () => {
    const root = checkout({ wrangler: WRANGLER_JSONC.replace(PLACEHOLDER_D1_DATABASE_ID, NEW_ID) })
    const { calls, executor } = recordingExecutor()

    expect(() => runD1Create({ checkoutDir: root, env }, executor)).toThrow(
      /refused -- no D1 binding .* still carries the placeholder/,
    )
    expect(() => runD1Create({ checkoutDir: root, env, binding: 'DB' }, executor)).toThrow(
      /already names database .*a real id is never overwritten/,
    )
    expect(calls).toHaveLength(0)
  })

  it('refuses a second run once the first has written the id', () => {
    const root = checkout()
    const { calls, executor } = recordingExecutor()
    runD1Create({ checkoutDir: root, env }, executor)
    expect(() => runD1Create({ checkoutDir: root, env }, executor)).toThrow(/refused/)
    expect(calls).toHaveLength(1)
  })

  it('takes the name from the manifest, and refuses when the wrangler config disagrees', () => {
    const named = checkout({
      manifest: manifest({ d1: [{ binding: 'DB', database_name: 'harbor-notes-prod' }] }),
    })
    expect(() => planD1Create({ checkoutDir: named, env })).toThrow(
      /names binding DB's database "harbor-notes-prod", but apps\/web\/wrangler.jsonc says "harbor-notes-db"/,
    )

    const agreeing = checkout({
      manifest: manifest({ d1: [{ binding: 'DB', database_name: 'harbor-notes-prod' }] }),
      wrangler: WRANGLER_JSONC.replace('"harbor-notes-db"', '"harbor-notes-prod"'),
    })
    expect(planD1Create({ checkoutDir: agreeing, env }).databaseName).toBe('harbor-notes-prod')
  })

  it('refuses a binding the manifest does not mirror', () => {
    const root = checkout({ manifest: manifest({ d1: [] }) })
    expect(() => planD1Create({ checkoutDir: root, env })).toThrow(
      /binding DB is not declared in Config\/cloudflare-app.json bindings.d1/,
    )
  })

  it('requires an explicit account, and refuses two that disagree', () => {
    const root = checkout()
    expect(() => planD1Create({ checkoutDir: root, env: {} })).toThrow(
      /no Cloudflare account named/,
    )

    const withAccount = checkout({
      wrangler: WRANGLER_JSONC.replace(
        '"name": "harbor-notes",',
        `"name": "harbor-notes",\n  "account_id": "${ACCOUNT}",`,
      ),
    })
    expect(planD1Create({ checkoutDir: withAccount, env: {} })).toMatchObject({
      accountId: ACCOUNT,
      accountSource: 'wrangler config account_id',
    })
    expect(() =>
      planD1Create({ checkoutDir: withAccount, env: { CLOUDFLARE_ACCOUNT_ID: 'f'.repeat(32) } }),
    ).toThrow(/disagree about which account/)
  })

  it('asks for --binding when more than one binding is a placeholder', () => {
    const two = WRANGLER_JSONC.replace(
      '  ],\n}',
      [
        '    {',
        '      "binding": "AUDIT_DB",',
        '      "database_name": "harbor-notes-audit-db",',
        `      "database_id": "${PLACEHOLDER_D1_DATABASE_ID}",`,
        '    },',
        '  ],',
        '}',
      ].join('\n'),
    )
    const root = checkout({
      wrangler: two,
      manifest: manifest({ d1: [{ binding: 'DB' }, { binding: 'AUDIT_DB' }] }),
    })
    expect(() => planD1Create({ checkoutDir: root, env })).toThrow(/choose one with --binding/)

    const { executor } = recordingExecutor(wranglerOutput('harbor-notes-audit-db', NEW_ID))
    runD1Create({ checkoutDir: root, env, binding: 'AUDIT_DB' }, executor)
    const written = readFileSync(join(root, 'apps/web/wrangler.jsonc'), 'utf8')
    // The DB binding keeps its placeholder; only AUDIT_DB's id moved.
    expect(written.indexOf(PLACEHOLDER_D1_DATABASE_ID)).toBeLessThan(written.indexOf(NEW_ID))
    expect(written.split(PLACEHOLDER_D1_DATABASE_ID)).toHaveLength(2)
  })

  it('does nothing on --dry-run', () => {
    const root = checkout()
    const { calls, executor } = recordingExecutor()
    const result = runD1Create({ checkoutDir: root, env, dryRun: true }, executor)
    expect(result).toMatchObject({
      status: 'dry-run',
      databaseId: null,
      databaseName: 'harbor-notes-db',
    })
    expect(calls).toHaveLength(0)
    expect(readFileSync(join(root, 'apps/web/wrangler.jsonc'), 'utf8')).toBe(WRANGLER_JSONC)
  })

  it('does not write when the file changed while wrangler ran, and says what now exists', () => {
    const root = checkout()
    const executor: D1CreateExecutor = () => {
      write(root, 'apps/web/wrangler.jsonc', WRANGLER_JSONC.replace('placeholder', 'edited'))
      return wranglerOutput('harbor-notes-db', NEW_ID)
    }
    expect(() => runD1Create({ checkoutDir: root, env }, executor)).toThrow(
      new RegExp(
        `changed while wrangler ran.*harbor-notes-db \\(${NEW_ID}\\) now exists in account ${ACCOUNT}.*Do not re-run`,
      ),
    )
    expect(readFileSync(join(root, 'apps/web/wrangler.jsonc'), 'utf8')).not.toContain(NEW_ID)
  })

  it('refuses output it cannot read an id from, pointing at the database that may now exist', () => {
    const root = checkout()
    const executor: D1CreateExecutor = () => '✅ Successfully created DB'
    expect(() => runD1Create({ checkoutDir: root, env }, executor)).toThrow(
      /reported no database_id.*wrangler d1 info harbor-notes-db.*Do not re-run db create/s,
    )
    expect(readFileSync(join(root, 'apps/web/wrangler.jsonc'), 'utf8')).toBe(WRANGLER_JSONC)
  })

  it('writes only JSON/JSONC configs inside the checkout', () => {
    expect(() =>
      planD1Create({
        checkoutDir: checkout({
          manifest: manifest({ worker: { wranglerConfig: 'wrangler.toml' } }),
        }),
        env,
      }),
    ).toThrow(/not a JSON\/JSONC wrangler config/)
    expect(() =>
      planD1Create({
        checkoutDir: checkout({
          manifest: manifest({ worker: { wranglerConfig: '../x/wrangler.jsonc' } }),
        }),
        env,
      }),
    ).toThrow(/must be a path inside the checkout/)
  })

  it('never builds a delete', () => {
    const plan = planD1Create({ checkoutDir: checkout(), env })
    expect(buildWranglerD1CreateArgs(plan).slice(0, 2)).toEqual(['d1', 'create'])
    expect(readFileSync(new URL('../src/d1-create.ts', import.meta.url), 'utf8')).not.toMatch(
      /['"]delete['"]/,
    )
  })
})

describe('db create helpers', () => {
  it('names a binding the way wrangler auto-provisioning and the generator do', () => {
    expect(conventionalD1DatabaseName('harbor-notes', 'DB')).toBe('harbor-notes-db')
    expect(conventionalD1DatabaseName('harbor-notes', 'AUDIT_DB')).toBe('harbor-notes-audit-db')
  })

  it('reads the id from the JSON and TOML snippets wrangler prints', () => {
    expect(parseD1CreateOutput(wranglerOutput('x-db', NEW_ID))).toBe(NEW_ID)
    expect(
      parseD1CreateOutput(
        `[[d1_databases]]\nbinding = "x_db"\ndatabase_name = "x-db"\ndatabase_id = "${NEW_ID.toUpperCase()}"\n`,
      ),
    ).toBe(NEW_ID)
    expect(() => parseD1CreateOutput('nothing here')).toThrow(/no database_id/)
    expect(() =>
      parseD1CreateOutput(
        `"database_id": "${NEW_ID}"\n"database_id": "11111111-2222-4333-8444-555555555555"`,
      ),
    ).toThrow(/2 different database ids/)
  })

  it('edits one value in place', () => {
    const text = '{\n  // keep\n  "d1_databases": [{ "database_id": "old" }]\n}\n'
    expect(withD1DatabaseId(text, 0, NEW_ID)).toBe(text.replace('"old"', `"${NEW_ID}"`))
  })

  it('parses flags and refuses a name argument', () => {
    expect(
      parseD1CreateArgs(['--checkout', '/tmp/app', '--binding', 'DB', '--dry-run', '--json']),
    ).toEqual({
      checkoutDir: '/tmp/app',
      binding: 'DB',
      dryRun: true,
      json: true,
    })
    expect(() => parseD1CreateArgs(['my-db'])).toThrow(/never passed as an argument/)
    expect(() => parseD1CreateArgs(['--binding'])).toThrow(/--binding requires a value/)
  })

  it('is reachable from the CLI, which refuses a directory that is not a checkout', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const empty = mkdtempSync(join(tmpdir(), 'd1-create-empty-'))
    tempDirs.push(empty)
    expect(await main(['db', 'create', '--checkout', empty, '--dry-run'])).toBe(1)
    expect(error.mock.calls.flat().join('\n')).toMatch(
      /db create: --checkout .* has no package.json/,
    )

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', ACCOUNT)
    try {
      expect(await main(['db', 'create', '--checkout', checkout(), '--dry-run'])).toBe(0)
    } finally {
      vi.unstubAllEnvs()
    }
    expect(log.mock.calls.flat().join('\n')).toContain(
      'dry run: would create D1 database harbor-notes-db',
    )
  })
})
