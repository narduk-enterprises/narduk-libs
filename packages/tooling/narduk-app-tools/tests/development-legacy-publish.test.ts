import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  describeLegacyPublishPath,
  findLegacyPublishPaths,
  legacyPublishRefusal,
  workspaceFilter,
} from '../src/development-legacy-publish.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function checkout(files: Record<string, string>): string {
  const outer = realpathSync(mkdtempSync(join(tmpdir(), 'legacy-publish-')))
  roots.push(outer)
  const root = join(outer, 'app')
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

const pkg = (scripts: Record<string, string>, name = 'web') =>
  JSON.stringify({ name, scripts }, null, 2)
/** Whether a real pnpm answers here; the pnpm-backed cases skip without one. */
const PNPM = spawnSync('pnpm', ['--version'], { encoding: 'utf8', timeout: 20_000 }).status === 0
const WORKSPACE = { 'pnpm-workspace.yaml': 'packages:\n  - apps/*\n' }
const found = (root: string) =>
  findLegacyPublishPaths(root, ['apps/web']).map(describeLegacyPublishPath)

/** The operator-portal legacy script's shape (agent-infrastructure#1679). */
const LEGACY_SCRIPT = [
  '#!/usr/bin/env bash',
  '# Development mode is NARDUK_ALLOW_MANUAL_PROMOTE=1 under our own record.',
  'mode_file="$state/mode.json"',
  'NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1 pnpm exec narduk-app deploy versions-upload',
  'NARDUK_ALLOW_MANUAL_PROMOTE=1 pnpm exec narduk-app deploy versions-promote --version-id "$v"',
  'pnpm exec wrangler triggers deploy',
  '',
].join('\n')

describe('app-owned publish paths (agent-infrastructure#1679)', () => {
  it('accepts deploy:dev as the enrolled command, with or without flags', () => {
    for (const command of [
      'narduk-app development deploy',
      'narduk-app development deploy --gated',
      'pnpm exec narduk-app development deploy',
      'npx narduk-app development deploy --red-main-fix 42',
    ]) {
      const root = checkout({ 'apps/web/package.json': pkg({ 'deploy:dev': command }) })
      expect(found(root), command).toEqual([])
    }
  })

  it('accepts an app with no deploy:dev and no armed override', () => {
    const root = checkout({
      'package.json': pkg({ build: 'nuxt build' }),
      'apps/web/package.json': pkg({ 'deploy:local': 'narduk-app deploy-local' }),
    })
    expect(found(root)).toEqual([])
  })

  it('names a deploy:dev that runs the app-owned script, and the override that script arms', () => {
    const root = checkout({
      'apps/web/package.json': pkg({ 'deploy:dev': 'script/dev/deploy_dev.sh' }),
      'apps/web/script/dev/deploy_dev.sh': LEGACY_SCRIPT,
    })
    expect(found(root)).toEqual([
      'apps/web/package.json "deploy:dev" runs "script/dev/deploy_dev.sh", not narduk-app development deploy',
      'apps/web/package.json "deploy:dev" runs apps/web/script/dev/deploy_dev.sh, which sets NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY (line 4)',
    ])
  })

  it('reads the resolved value and the duplicate when a merge kept both deploy:dev keys', () => {
    const merged = [
      '{',
      '  "scripts": {',
      '    "deploy:dev": "narduk-app development deploy",',
      '    "build": "nuxt build",',
      '    "deploy:dev": "script/dev/deploy_dev.sh"',
      '  }',
      '}',
    ].join('\n')
    const root = checkout({
      'apps/web/package.json': merged,
      'apps/web/script/dev/deploy_dev.sh': LEGACY_SCRIPT,
    })
    const findings = found(root)
    expect(findings[0]).toMatch(/"deploy:dev" is declared 2 times; JSON keeps the last/u)
    expect(findings[1]).toMatch(/runs "script\/dev\/deploy_dev.sh", not narduk-app development/u)
    // Converted key last: still refused, because the next merge can reorder them.
    const reordered = checkout({
      'apps/web/package.json': merged
        .replace('"narduk-app development deploy"', '"X"')
        .replace('"script/dev/deploy_dev.sh"', '"narduk-app development deploy"')
        .replace('"X"', '"script/dev/deploy_dev.sh"'),
    })
    expect(found(reordered)).toEqual([
      'apps/web/package.json "deploy:dev" is declared 2 times; JSON keeps the last, so a merge can re-arm a retired script',
    ])
  })

  it('refuses a deploy:dev that composes the enrolled command with anything else', () => {
    const root = checkout({
      'apps/web/package.json': pkg({
        'deploy:dev': 'narduk-app development deploy && script/dev/deploy_dev.sh',
      }),
    })
    expect(found(root)).toHaveLength(1)
  })

  it('accepts -C and --dir forwards to an enrolled component without asking pnpm', () => {
    const select = vi.spyOn(workspaceFilter, 'select')
    for (const forward of [
      'pnpm -C apps/web run deploy:dev',
      'pnpm --dir apps/web run deploy:dev',
    ]) {
      const root = checkout({
        'package.json': pkg({ 'deploy:dev': forward }, 'root'),
        'apps/web/package.json': pkg({ 'deploy:dev': 'narduk-app development deploy' }),
      })
      expect(found(root), forward).toEqual([])
    }
    expect(select).not.toHaveBeenCalled()
  })

  it('refuses a filter forward when pnpm cannot say what it selects', () => {
    vi.spyOn(workspaceFilter, 'select').mockReturnValue(
      'pnpm could not be asked (spawn pnpm ENOENT)',
    )
    const root = checkout({
      ...WORKSPACE,
      'package.json': pkg({ 'deploy:dev': 'pnpm --filter web run deploy:dev' }, 'root'),
      'apps/web/package.json': pkg({ 'deploy:dev': 'narduk-app development deploy' }),
    })
    expect(found(root)).toEqual([
      'package.json "deploy:dev" forwards with --filter web, but pnpm could not be asked (spawn pnpm ENOENT), so which packages it runs is unknown',
    ])
  })

  it('refuses a filter forward that selects anything but exactly one enrolled component', () => {
    const select = vi.spyOn(workspaceFilter, 'select')
    const root = checkout({
      ...WORKSPACE,
      'package.json': pkg({ 'deploy:dev': 'pnpm --filter web run deploy:dev' }, 'root'),
      'apps/web/package.json': pkg({ 'deploy:dev': 'narduk-app development deploy' }),
    })
    const web = { name: 'web', path: join(root, 'apps/web') }
    select.mockReturnValue([web, { name: 'web', path: join(root, 'packages/w2') }])
    expect(found(root)).toEqual([
      'package.json "deploy:dev" forwards with --filter web, which pnpm resolves to 2 workspace packages (apps/web, packages/w2); a forward must select exactly one enrolled component',
    ])
    select.mockReturnValue([])
    expect(found(root)[0]).toContain('which pnpm resolves to 0 workspace packages')
    select.mockReturnValue([{ name: 'web', path: join(root, 'legacy') }])
    expect(found(root)).toEqual([
      'package.json "deploy:dev" forwards to "web", which is not an enrolled component',
    ])
    select.mockReturnValue([web])
    expect(found(root)).toEqual([])
  })

  it('refuses a filter with a glob or graph selector before asking pnpm', () => {
    const select = vi.spyOn(workspaceFilter, 'select')
    for (const filter of ['web...', '...web', 'w*', '{apps/web}', './apps/*', 'web^...']) {
      const root = checkout({
        ...WORKSPACE,
        'package.json': pkg({ 'deploy:dev': `pnpm --filter ${filter} run deploy:dev` }, 'root'),
        'apps/web/package.json': pkg({ 'deploy:dev': 'narduk-app development deploy' }),
      })
      expect(found(root), filter).toHaveLength(1)
    }
    expect(select).not.toHaveBeenCalled()
  })

  describe.skipIf(!PNPM)('with the real pnpm', () => {
    const enrolled = pkg({ 'deploy:dev': 'narduk-app development deploy' })
    const legacy = pkg({ 'deploy:dev': 'script/dev/deploy_dev.sh' })
    const forwarding = (workspace: string, files: Record<string, string>, filter = 'web') =>
      checkout({
        'pnpm-workspace.yaml': workspace,
        'package.json': pkg({ 'deploy:dev': `pnpm --filter ${filter} run deploy:dev` }, 'root'),
        'apps/web/package.json': enrolled,
        ...files,
      })

    it('accepts the template root and its filter forms', { timeout: 120_000 }, () => {
      for (const forward of [
        'pnpm --filter web run deploy:dev',
        'pnpm --filter=web run deploy:dev',
        'pnpm -F web run deploy:dev -- --gated',
        'pnpm --filter ./apps/web run deploy:dev',
      ]) {
        const root = checkout({
          ...WORKSPACE,
          'package.json': pkg({ 'deploy:dev': forward }, 'root'),
          'apps/web/package.json': enrolled,
          'apps/api/package.json': pkg({ build: 'x' }, 'api'),
        })
        expect(found(root), forward).toEqual([])
      }
      const excluded = forwarding(
        'packages:\n  - "apps/**"\n  - "packages/*"\n  - "!packages/w2"\n',
        {
          'packages/w2/package.json': legacy,
          'tools/web/package.json': legacy,
        },
      )
      expect(found(excluded)).toEqual([])
    })

    it('refuses every second package pnpm would also run', { timeout: 120_000 }, () => {
      const shapes: Array<[string, Record<string, string>, ((root: string) => void)?]> = [
        ['packages:\n  - "apps/*"\n  - "packages/*"\n', { 'packages/w2/package.json': legacy }],
        ['packages:\n  - "apps/**"\n', { 'apps/a/b/c/d/e/f/g/h/package.json': legacy }],
        ['packages:\n  - "apps/*"\n  - "legacy/{a,b}"\n', { 'legacy/a/package.json': legacy }],
        ['packages:\n  - "apps/*"\n  - "legacy/[ab]"\n', { 'legacy/a/package.json': legacy }],
        [
          'packages:\n  - "apps/*"\n',
          { 'apps/w2/package.yaml': 'name: web\nscripts:\n  deploy:dev: x\n' },
        ],
        [
          'packages:\n  - "apps/*"\n',
          { 'elsewhere/w2/package.json': legacy },
          (root) => symlinkSync(join(root, 'elsewhere/w2'), join(root, 'apps/w2'), 'junction'),
        ],
        // No workspace file: pnpm still runs every package named web below the root.
        ['', { 'packages/w2/package.json': legacy }],
      ]
      for (const [workspace, files, setup] of shapes) {
        const root = forwarding(workspace, files)
        if (!workspace) rmSync(join(root, 'pnpm-workspace.yaml'))
        setup?.(root)
        const findings = found(root)
        expect(findings, JSON.stringify(files)).toHaveLength(1)
        expect(findings[0]).toContain('which pnpm resolves to 2 workspace packages')
      }
      const rootNamedWeb = checkout({
        ...WORKSPACE,
        'package.json': pkg({ 'deploy:dev': 'pnpm --filter web run deploy:dev' }),
        'apps/web/package.json': enrolled,
      })
      expect(found(rootNamedWeb)[0]).toContain(
        'which pnpm resolves to 2 workspace packages (., apps/web)',
      )
      const unreadable = forwarding('packages: [', {})
      expect(found(unreadable)[0]).toContain('so which packages it runs is unknown')
    })

    it(
      'refuses a root forward to anything but an enrolled component running the tool',
      { timeout: 120_000 },
      () => {
        const elsewhere = forwarding(
          WORKSPACE['pnpm-workspace.yaml'],
          {
            'apps/legacy/package.json': pkg({ 'deploy:dev': 'script/dev/deploy_dev.sh' }, 'legacy'),
          },
          'legacy',
        )
        expect(found(elsewhere)).toEqual([
          'package.json "deploy:dev" forwards to "legacy", which is not an enrolled component',
        ])
        const legacyComponent = checkout({
          ...WORKSPACE,
          'package.json': pkg({ 'deploy:dev': 'pnpm --filter web run deploy:dev' }, 'root'),
          'apps/web/package.json': legacy,
        })
        expect(found(legacyComponent)).toEqual([
          'package.json "deploy:dev" forwards to apps/web/package.json, whose deploy:dev is not exactly narduk-app development deploy',
          'apps/web/package.json "deploy:dev" runs "script/dev/deploy_dev.sh", not narduk-app development deploy',
        ])
      },
    )
  })

  it('refuses a forward composed with anything else', () => {
    const composed = checkout({
      'package.json': pkg({ 'deploy:dev': 'pnpm --filter web run deploy:dev && ./ship.sh' }),
      'apps/web/package.json': pkg({ 'deploy:dev': 'narduk-app development deploy' }),
    })
    expect(found(composed)).toHaveLength(1)
  })

  it('refuses a second line after the enrolled command or a forward', () => {
    for (const command of [
      'narduk-app development deploy\nscript/dev/deploy_dev.sh',
      'narduk-app development deploy --gated\r\nscript/dev/deploy_dev.sh',
      'narduk-app\ndevelopment deploy',
    ]) {
      const root = checkout({ 'apps/web/package.json': pkg({ 'deploy:dev': command }) })
      expect(found(root), JSON.stringify(command)).toHaveLength(1)
    }
    const root = checkout({
      'package.json': pkg({ 'deploy:dev': 'pnpm --filter web run deploy:dev\n./ship.sh' }),
      'apps/web/package.json': pkg({ 'deploy:dev': 'narduk-app development deploy' }),
    })
    expect(found(root)).toHaveLength(1)
  })

  it('refuses predeploy:dev and postdeploy:dev, which pnpm runs around it', () => {
    const root = checkout({
      'package.json': pkg({ postdeploy: 'x', 'postdeploy:dev': 'wrangler triggers deploy' }),
      'apps/web/package.json': pkg({
        'deploy:dev': 'narduk-app development deploy',
        'predeploy:dev': 'echo hi',
      }),
    })
    expect(found(root)).toEqual([
      'package.json "postdeploy:dev" runs automatically around deploy:dev; development deploy owns that path',
      'apps/web/package.json "predeploy:dev" runs automatically around deploy:dev; development deploy owns that path',
    ])
  })

  it('names any script that arms a publish override inline, under any name', () => {
    const root = checkout({
      'package.json': pkg({
        'ship:prod': 'NARDUK_ALLOW_MANUAL_PROMOTE=1 narduk-app deploy versions-promote',
      }),
      'apps/web/package.json': pkg({ push: 'export NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=true; x' }),
    })
    expect(found(root)).toEqual([
      'package.json "ship:prod" sets NARDUK_ALLOW_MANUAL_PROMOTE, a workstation publish override',
      'apps/web/package.json "push" sets NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY, a workstation publish override',
    ])
  })

  it('passes the estate guards that only read an override or name it in a message', () => {
    // Verbatim shapes from austin-texas-net, clawdle and been-sober-for (account id elided).
    const cfDeploy =
      'case "${SKIP_DEPENDENCY_INSTALL:-}:${NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY:-}" in 1:*|true:*|*:1|*:true|*:yes|*:on) ;; *) echo "cf:deploy: local wrangler deploy is disabled. Push to main for Workers Builds or set NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1 for recovery work." >&2; exit 1 ;; esac && if [ "${SKIP_DB_MIGRATE_REMOTE:-}" = "1" ] || [ "${SKIP_DB_MIGRATE_REMOTE:-}" = "true" ]; then echo "cf:deploy: skipping db:migrate:remote (SKIP_DB_MIGRATE_REMOTE)"; else pnpm run --if-present db:migrate:remote; fi && node ../../scripts/toolchain.mjs wrangler-deploy deploy'
    const staging =
      'test "${NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY:-}" = "1" || { echo "Refusing local staging deploy. Set NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1 after reviewing the target." >&2; exit 1; }; pnpm run cf:build:staging && CLOUDFLARE_ACCOUNT_ID=x pnpm exec wrangler deploy --config wrangler.staging.jsonc'
    const bootstrap =
      'test "${NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY:-}" = "1" || { echo "Refusing remote staging migration without NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1." >&2; exit 1; }; if [ -n "${NARDUK_CLOUDFLARE_D1_MIGRATE_TOKEN:-}" ]; then export CLOUDFLARE_API_TOKEN="$NARDUK_CLOUDFLARE_D1_MIGRATE_TOKEN"; fi; CLOUDFLARE_ACCOUNT_ID=x narduk-app db migrate --remote'
    const root = checkout({
      'apps/web/package.json': pkg({
        'cf:deploy': cfDeploy,
        'cf:deploy:staging': staging,
        'db:migrate:staging:remote:bootstrap': bootstrap,
        'single-quoted': "echo 'set NARDUK_ALLOW_MANUAL_PROMOTE=1 by hand' >&2; exit 1",
        'unquoted-reader': '[ $NARDUK_ALLOW_MANUAL_PROMOTE = 1 ] && echo armed',
        printf: "printf '%s\\n' 'set NARDUK_ALLOW_MANUAL_PROMOTE=1 by hand' 1>&2",
        check: 'script/check.sh',
      }),
      'apps/web/script/check.sh':
        '# never set NARDUK_ALLOW_MANUAL_PROMOTE=1 here\necho "or NARDUK_ALLOW_MANUAL_PROMOTE=1"\n',
      'scripts/toolchain.mjs': [
        "// NARDUK_ALLOW_MANUAL_PROMOTE: '1' is never set here",
        "if (env.NARDUK_ALLOW_MANUAL_PROMOTE === '1') run()",
        'if (env.NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY == 1) run()',
        "console.error('set NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1 for recovery work')",
        'if (!armed) throw new Error("set NARDUK_ALLOW_MANUAL_PROMOTE=1 by hand first")',
        '/* NARDUK_ALLOW_MANUAL_PROMOTE=1 is never set here */ run()',
        '',
      ].join('\n'),
    })
    expect(found(root)).toEqual([])
  })

  it('catches every real setter shape, inline and in files a script runs', () => {
    const root = checkout({
      'apps/web/package.json': pkg({
        a: 'env NARDUK_ALLOW_MANUAL_PROMOTE=1 narduk-app deploy versions-promote',
        b: 'export NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=true; wrangler deploy',
        c: 'NARDUK_ALLOW_MANUAL_PROMOTE=yes narduk-app deploy versions-promote',
        d: 'cross-env NARDUK_ALLOW_MANUAL_PROMOTE=1 narduk-app deploy versions-promote',
        e: 'OUT=x NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY="1" wrangler deploy',
        f: 'pnpm build && NARDUK_ALLOW_MANUAL_PROMOTE=on narduk-app deploy versions-promote',
        g: 'bash script/ship.sh',
        h: 'node script/ship.mjs',
        i: 'node script/spawn.mjs',
        j: 'node script/assign.mjs',
        k: `sh -c 'NARDUK_ALLOW_MANUAL_PROMOTE=1 narduk-app deploy versions-promote'`,
        l: 'env "NARDUK_ALLOW_MANUAL_PROMOTE=1" narduk-app deploy versions-promote',
        m: 'declare -x NARDUK_ALLOW_MANUAL_PROMOTE=1; narduk-app deploy versions-promote',
        n: 'sudo -E NARDUK_ALLOW_MANUAL_PROMOTE=1 narduk-app deploy versions-promote',
        o: 'env -u FOO NARDUK_ALLOW_MANUAL_PROMOTE=1 narduk-app deploy versions-promote',
        p: 'echo set NARDUK_ALLOW_MANUAL_PROMOTE=1 to recover',
        q: 'node script/exec.mjs',
        r: 'node script/comment.mjs',
        s: `sh -c "npx cross-env NARDUK_ALLOW_MANUAL_PROMOTE=1 narduk-app deploy versions-promote"`,
        t: `sh -c "echo | xargs env NARDUK_ALLOW_MANUAL_PROMOTE=1 narduk-app deploy versions-promote"`,
        u: `sh -c "timeout 60 env NARDUK_ALLOW_MANUAL_PROMOTE=1 narduk-app deploy versions-promote"`,
        v: `sh -c "caffeinate -i env NARDUK_ALLOW_MANUAL_PROMOTE=1 narduk-app deploy versions-promote"`,
        w: 'echo \\"; npx cross-env NARDUK_ALLOW_MANUAL_PROMOTE=1 wrangler deploy #\\"',
        x: `sh -c "echo 'set NARDUK_ALLOW_MANUAL_PROMOTE=1 first'"`,
        y: 'echo "NARDUK_ALLOW_MANUAL_PROMOTE=1 narduk-app deploy versions-promote" | sh',
        z: 'echo "NARDUK_ALLOW_MANUAL_PROMOTE=1" > .env && narduk-app deploy versions-promote',
        za: 'eval $(echo "NARDUK_ALLOW_MANUAL_PROMOTE=1")',
        zb: 'node script/wrapped.mjs',
        zc: 'node script/field.mjs',
      }),
      'apps/web/script/ship.sh':
        'set -e\n  NARDUK_ALLOW_MANUAL_PROMOTE=1 pnpm exec narduk-app deploy versions-promote\n',
      'apps/web/script/ship.mjs':
        "spawnSync('narduk-app', args, { env: { ...process.env, NARDUK_ALLOW_MANUAL_PROMOTE: '1' } })\n",
      'apps/web/script/spawn.mjs':
        "execSync('NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1 wrangler deploy')\n",
      'apps/web/script/assign.mjs': "process.env['NARDUK_ALLOW_MANUAL_PROMOTE'] = 'true'\n",
      'apps/web/script/exec.mjs':
        'execSync("export NARDUK_ALLOW_MANUAL_PROMOTE=1; narduk-app deploy versions-promote")\n',
      'apps/web/script/comment.mjs': "/* c */ process.env.NARDUK_ALLOW_MANUAL_PROMOTE = '1'\n",
      'apps/web/script/wrapped.mjs': [
        "console.log('deploying')",
        'execSync("pnpm exec cross-env NARDUK_ALLOW_MANUAL_PROMOTE=1 narduk-app deploy versions-promote")',
        '',
      ].join('\n'),
      'apps/web/script/field.mjs':
        "class Ship {\n  #env = { NARDUK_ALLOW_MANUAL_PROMOTE: '1' }\n}\n",
    })
    expect(found(root).map((line) => line.split('"')[1])).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
      'k',
      'l',
      'm',
      'n',
      'o',
      'p',
      'q',
      'r',
      's',
      't',
      'u',
      'v',
      'w',
      'x',
      'y',
      'z',
      'za',
      'zb',
      'zc',
    ])
  })

  it('does not follow a script path out of the checkout', () => {
    const root = checkout({ 'apps/web/package.json': pkg({ ship: '../../../outside.sh' }) })
    writeFileSync(join(dirname(root), 'outside.sh'), 'NARDUK_ALLOW_MANUAL_PROMOTE=1 x\n')
    expect(found(root)).toEqual([])
  })

  it('refuses a package.json it cannot parse', () => {
    const root = checkout({ 'apps/web/package.json': '{ "scripts": { "deploy:dev": ' })
    expect(found(root)).toEqual([
      'apps/web/package.json "(file)" does not parse as JSON, so what "deploy:dev" runs cannot be known',
    ])
  })

  it('reads the root package.json once when a component lives at the root', () => {
    const root = checkout({ 'package.json': pkg({ 'deploy:dev': 'bash deploy.sh' }) })
    expect(findLegacyPublishPaths(root, ['.', '.'])).toHaveLength(1)
  })

  it('tells the operator how to retire the path and that entry changed nothing', () => {
    const message = legacyPublishRefusal([
      { packageJson: 'apps/web/package.json', script: 'deploy:dev', reason: 'runs "x"' },
    ])
    expect(message).toContain('  apps/web/package.json "deploy:dev" runs "x"')
    expect(message).toMatch(/keep exactly one "deploy:dev" per package/u)
    expect(message).toMatch(/Entry changed nothing in the app\./u)
  })
})
