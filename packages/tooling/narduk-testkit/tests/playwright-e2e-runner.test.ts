import { describe, expect, it } from 'vitest'

import {
  WEB_PROJECT_NAME,
  resolveBrowserCachePath as resolveBrowserCachePathFromConfig,
  withDefaultProject as withDefaultProjectFromConfig,
} from '../src/playwright/config.js'
import {
  DEFAULT_E2E_PROJECT,
  type E2eRunnerDeps,
  type E2eSpawnResult,
  parseE2eRunArgs,
  resolveBrowserCachePath,
  resolvePlaywrightConfigPath,
  runE2eCommand,
  selectsPlaywrightConfig,
  selectsPlaywrightProject,
  withDefaultProject,
  withTsxImport,
} from '../src/playwright/e2e-runner.js'

interface SpawnCall {
  args: string[]
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
}

function fakeDeps(
  options: {
    env?: NodeJS.ProcessEnv
    files?: readonly string[]
    resolvable?: Record<string, string>
    results?: E2eSpawnResult[]
  } = {},
): E2eRunnerDeps & { calls: SpawnCall[]; errors: string[]; logs: string[] } {
  const calls: SpawnCall[] = []
  const errors: string[] = []
  const logs: string[] = []
  const results = [...(options.results ?? [])]
  const files = new Set(options.files ?? [])
  const resolvable = options.resolvable ?? {
    '@playwright/test/cli': '/app/node_modules/@playwright/test/cli.js',
    tsx: '/app/node_modules/tsx/dist/loader.mjs',
  }
  return {
    calls,
    cwd: '/app',
    env: options.env ?? {},
    error: (message) => errors.push(message),
    errors,
    exists: (path) => files.has(path),
    log: (message) => logs.push(message),
    logs,
    nodePath: '/usr/bin/node',
    resolveFrom: (specifier) => resolvable[specifier],
    spawn: (command, args, spawnOptions) => {
      calls.push({ args: [...args], command, cwd: spawnOptions.cwd, env: spawnOptions.env })
      return results.shift() ?? { status: 0, stderr: '' }
    },
  }
}

describe('resolveBrowserCachePath', () => {
  it('keeps a non-empty ambient PLAYWRIGHT_BROWSERS_PATH exactly (isolated CI guests)', () => {
    expect(resolveBrowserCachePath({ PLAYWRIGHT_BROWSERS_PATH: '/opt/ms-playwright' })).toBe(
      '/opt/ms-playwright',
    )
  })

  it("defers to Playwright's shared machine cache when the variable is unset or blank", () => {
    // A per-checkout `.cache/ms-playwright` default downloaded ~500 MB per worktree (buoys, 2026-09-18).
    expect(resolveBrowserCachePath({})).toBeUndefined()
    expect(resolveBrowserCachePath({ PLAYWRIGHT_BROWSERS_PATH: '   ' })).toBeUndefined()
  })

  it('is re-exported from playwright/config for apps with a custom runner', () => {
    expect(resolveBrowserCachePathFromConfig).toBe(resolveBrowserCachePath)
  })
})

describe('withDefaultProject', () => {
  it('adds --project=web only when the caller chose no project', () => {
    expect(withDefaultProject(['--grep', 'smoke'])).toEqual(['--project=web', '--grep', 'smoke'])
    expect(DEFAULT_E2E_PROJECT).toBe(WEB_PROJECT_NAME)
  })

  it.each([
    [['--project=pr']],
    [['--project', 'pr']],
    [['-p', 'pr']],
    [['--grep', 'x', '--project=quarantine']],
  ])(
    'never adds a second project when the caller passed %j (Playwright accumulates them)',
    (args) => {
      expect(withDefaultProject(args)).toEqual(args)
      expect(selectsPlaywrightProject(args)).toBe(true)
    },
  )

  it('takes a different default project', () => {
    expect(withDefaultProject([], 'pr')).toEqual(['--project=pr'])
  })

  it('does not mutate its input', () => {
    const args = ['--grep', 'x']
    withDefaultProject(args)
    expect(args).toEqual(['--grep', 'x'])
  })

  it('is re-exported from playwright/config', () => {
    expect(withDefaultProjectFromConfig).toBe(withDefaultProject)
  })
})

describe('withTsxImport', () => {
  it('prepends --import tsx to NODE_OPTIONS', () => {
    expect(withTsxImport(undefined)).toBe('--import tsx')
    expect(withTsxImport('--max-old-space-size=3072')).toBe(
      '--import tsx --max-old-space-size=3072',
    )
  })

  it.each(['--import tsx', '--import=tsx', '--max-old-space-size=1 --import tsx'])(
    'adds it once: %s',
    (existing) => {
      expect(withTsxImport(existing)).toBe(existing)
    },
  )

  it('does not mistake another --import for tsx', () => {
    expect(withTsxImport('--import tsx-extra')).toBe('--import tsx --import tsx-extra')
  })
})

describe('resolvePlaywrightConfigPath', () => {
  it('prefers the checkout-root config, then apps/web', () => {
    expect(
      resolvePlaywrightConfigPath('/app', undefined, (path) =>
        ['/app/playwright.config.ts', '/app/apps/web/playwright.config.ts'].includes(path),
      ),
    ).toBe('/app/playwright.config.ts')
    expect(
      resolvePlaywrightConfigPath(
        '/app',
        undefined,
        (path) => path === '/app/apps/web/playwright.config.ts',
      ),
    ).toBe('/app/apps/web/playwright.config.ts')
  })

  it('returns undefined when no default exists, so Playwright does its own discovery', () => {
    expect(resolvePlaywrightConfigPath('/app', undefined, () => false)).toBeUndefined()
  })

  it('resolves an explicit config against the working directory and requires it to exist', () => {
    expect(
      resolvePlaywrightConfigPath(
        '/app',
        'e2e/pw.config.ts',
        (path) => path === '/app/e2e/pw.config.ts',
      ),
    ).toBe('/app/e2e/pw.config.ts')
    expect(() => resolvePlaywrightConfigPath('/app', 'missing.ts', () => false)).toThrow(
      /missing\.ts/,
    )
  })
})

describe('parseE2eRunArgs', () => {
  it('passes everything after -- to Playwright', () => {
    expect(parseE2eRunArgs(['--config', 'a.ts', '--', '--project=pr', '--grep', 'x'])).toEqual({
      config: 'a.ts',
      defaultProject: 'web',
      playwrightArgs: ['--project=pr', '--grep', 'x'],
    })
  })

  it('treats the first unknown argument as the start of the Playwright args (pnpm test:e2e --project=pr)', () => {
    expect(parseE2eRunArgs(['--project=pr', '--headed'])).toEqual({
      defaultProject: 'web',
      playwrightArgs: ['--project=pr', '--headed'],
    })
  })

  it('drops a leading -- that pnpm forwards', () => {
    expect(parseE2eRunArgs(['--', 'tests/a.web.spec.ts'])).toEqual({
      defaultProject: 'web',
      playwrightArgs: ['tests/a.web.spec.ts'],
    })
  })

  it('reads --config=, --default-project and --no-default-project', () => {
    expect(parseE2eRunArgs(['--config=x.ts', '--default-project=pr'])).toEqual({
      config: 'x.ts',
      defaultProject: 'pr',
      playwrightArgs: [],
    })
    expect(parseE2eRunArgs(['--no-default-project'])).toEqual({
      defaultProject: false,
      playwrightArgs: [],
    })
  })

  it('rejects a flag that is missing its value', () => {
    expect(() => parseE2eRunArgs(['--config'])).toThrow(/--config/)
    expect(() => parseE2eRunArgs(['--default-project'])).toThrow(/--default-project/)
  })

  it('detects a caller-chosen Playwright config', () => {
    expect(selectsPlaywrightConfig(['--config=x.ts'])).toBe(true)
    expect(selectsPlaywrightConfig(['-c', 'x.ts'])).toBe(true)
    expect(selectsPlaywrightConfig(['--grep', 'x'])).toBe(false)
  })
})

describe('runE2eCommand', () => {
  it('check launches Chromium headless in the app checkout and exits 0', () => {
    const deps = fakeDeps()
    expect(runE2eCommand(['check'], deps)).toBe(0)
    expect(deps.calls).toHaveLength(1)
    const [call] = deps.calls
    expect(call.command).toBe('/usr/bin/node')
    expect(call.cwd).toBe('/app')
    expect(call.args.join(' ')).toContain('chromium.launch({ headless: true })')
    expect(deps.errors).toEqual([])
  })

  it('check exits 1 with the setup hint and the launch error when Chromium cannot start', () => {
    const deps = fakeDeps({
      env: { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw' },
      results: [{ status: 1, stderr: 'error while loading shared libraries: libnss3.so\n' }],
    })
    expect(runE2eCommand(['check'], deps)).toBe(1)
    const message = deps.errors.join('\n')
    expect(message).toContain('narduk-testkit e2e setup')
    expect(message).toContain('/opt/pw')
    expect(message).toContain('libnss3.so')
  })

  it("quotes the missing-executable line and drops Playwright's install banner", () => {
    const deps = fakeDeps({
      results: [
        {
          status: 1,
          stderr: [
            "browserType.launch: Executable doesn't exist at /pw/chromium-1/chrome",
            '╔══════════════════╗',
            '║ npx playwright install ║',
            '╚══════════════════╝',
            '',
          ].join('\n'),
        },
      ],
    })
    expect(runE2eCommand(['check'], deps)).toBe(1)
    const message = deps.errors.join('\n')
    expect(message).toContain("Executable doesn't exist at /pw/chromium-1/chrome")
    expect(message).not.toContain('npx playwright install')
    expect(message).toContain("Playwright's shared machine cache")
  })

  it("setup installs Chromium with the app's Playwright into the ambient or shared cache", () => {
    const deps = fakeDeps({ env: { PATH: '/bin' } })
    expect(runE2eCommand(['setup', '--', '--with-deps'], deps)).toBe(0)
    expect(deps.calls).toEqual([
      {
        args: ['/app/node_modules/@playwright/test/cli.js', 'install', 'chromium', '--with-deps'],
        command: '/usr/bin/node',
        cwd: '/app',
        env: { PATH: '/bin' },
      },
    ])
    // The shared cache is Playwright's own default: the runner never invents a per-checkout path.
    expect(deps.calls[0].env.PLAYWRIGHT_BROWSERS_PATH).toBeUndefined()
  })

  it('run checks first, then runs playwright test with the default project, config and tsx', () => {
    const deps = fakeDeps({
      env: { NODE_OPTIONS: '--max-old-space-size=3072' },
      files: ['/app/playwright.config.ts'],
    })
    expect(runE2eCommand(['run', '--grep', 'smoke'], deps)).toBe(0)
    expect(deps.calls).toHaveLength(2)
    expect(deps.calls[0].args.join(' ')).toContain('chromium.launch')
    expect(deps.calls[1]).toEqual({
      args: [
        '/app/node_modules/@playwright/test/cli.js',
        'test',
        '--config=/app/playwright.config.ts',
        '--project=web',
        '--grep',
        'smoke',
      ],
      command: '/usr/bin/node',
      cwd: '/app',
      env: { NODE_OPTIONS: '--import tsx --max-old-space-size=3072' },
    })
  })

  it('run keeps the caller project and config and adds neither default', () => {
    const deps = fakeDeps({ files: ['/app/playwright.config.ts'] })
    expect(runE2eCommand(['run', '--', '--project=pr', '-c', 'other.config.ts'], deps)).toBe(0)
    expect(deps.calls[1].args).toEqual([
      '/app/node_modules/@playwright/test/cli.js',
      'test',
      '--project=pr',
      '-c',
      'other.config.ts',
    ])
  })

  it('run does not start Playwright when the browser check fails', () => {
    const deps = fakeDeps({ results: [{ status: 1, stderr: 'Executable does not exist' }] })
    expect(runE2eCommand(['run'], deps)).toBe(1)
    expect(deps.calls).toHaveLength(1)
  })

  it('run returns the Playwright exit status', () => {
    const deps = fakeDeps({
      results: [
        { status: 0, stderr: '' },
        { status: 3, stderr: '' },
      ],
    })
    expect(runE2eCommand(['run'], deps)).toBe(3)
  })

  it('run leaves NODE_OPTIONS alone when tsx is not installed in the app', () => {
    const deps = fakeDeps({
      env: { NODE_OPTIONS: '--enable-source-maps' },
      resolvable: { '@playwright/test/cli': '/app/node_modules/@playwright/test/cli.js' },
    })
    expect(runE2eCommand(['run'], deps)).toBe(0)
    expect(deps.calls[1].env.NODE_OPTIONS).toBe('--enable-source-maps')
  })

  it('names the missing @playwright/test instead of spawning nothing useful', () => {
    const deps = fakeDeps({ resolvable: {} })
    expect(runE2eCommand(['setup'], deps)).toBe(1)
    expect(deps.errors.join('\n')).toMatch(/@playwright\/test/)
    expect(deps.calls).toEqual([])
  })

  it('reports a spawn error and exits 1', () => {
    const deps = fakeDeps({
      results: [{ error: new Error('ENOENT node'), status: null, stderr: '' }],
    })
    expect(runE2eCommand(['setup'], deps)).toBe(1)
    expect(deps.errors.join('\n')).toContain('ENOENT node')
  })

  it('prints usage for help and rejects an unknown subcommand', () => {
    const help = fakeDeps()
    expect(runE2eCommand(['--help'], help)).toBe(0)
    expect(help.logs.join('\n')).toContain('narduk-testkit e2e run')

    const unknown = fakeDeps()
    expect(runE2eCommand(['install'], unknown)).toBe(1)
    expect(unknown.errors.join('\n')).toContain('narduk-testkit e2e check')
  })
})
