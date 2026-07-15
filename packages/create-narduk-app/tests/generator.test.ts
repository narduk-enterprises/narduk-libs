import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

import * as prettier from 'prettier'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildGeneratedFiles, createNardukApp, PACKAGE_VERSIONS, runCli } from '../src/index.js'

const tempDirectories: string[] = []

async function makeTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'create-narduk-app-'))
  tempDirectories.push(directory)
  return directory
}

function asFileMap(files: ReturnType<typeof buildGeneratedFiles>): Map<string, string> {
  return new Map(files.map((file) => [file.path, file.contents]))
}

function collectVersionedDependencies(manifest: Record<string, unknown>): Record<string, string> {
  return {
    ...(manifest.dependencies as Record<string, string>),
    ...(manifest.devDependencies as Record<string, string>),
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('create-narduk-app generation contract', () => {
  it('produces byte-identical plans independent of target directory', () => {
    const options = {
      appName: 'harbor-notes',
      capabilities: ['mapkit', 'auth', 'seo', 'auth'],
      description: 'A harbor log.',
      displayName: 'Harbor Notes',
      localPort: 4310,
      noGit: true,
      productSpec: {
        audience: 'Boat crews',
        problem: 'Log observations quickly.',
      },
      siteUrl: 'https://harbor.example',
      targetDir: '/one/target',
      visibility: 'public' as const,
    }
    const first = asFileMap(buildGeneratedFiles(options))
    const second = asFileMap(buildGeneratedFiles({ ...options, targetDir: '/two/target' }))

    expect([...first.keys()]).toEqual([...second.keys()])
    expect(first).toEqual(second)
    expect(first.has('create-narduk-app-report.json')).toBe(false)
    expect(first.get('.github/workflows/ci.yml')).toContain('runs-on: ubuntu-latest')
    expect([...first.values()].join('\n')).not.toContain('/one/target')
    expect([...first.values()].join('\n')).not.toContain('/two/target')
  })

  it('renders user-provided display text through Vue bindings', async () => {
    const files = asFileMap(
      buildGeneratedFiles({
        appName: 'escaped-copy',
        capabilities: ['seo'],
        description: 'R&D says <ship> & "sail".',
        displayName: 'Fish & <Ships> {{ crew }} learns </script> tags',
        noGit: true,
        targetDir: '/tmp/escaped-copy',
      }),
    )
    const page = files.get('apps/web/app/pages/index.vue') ?? ''

    expect(page).toContain('<h1>{{ displayName }}</h1>')
    expect(page).toContain('<p>{{ description }}</p>')
    expect(page).not.toContain('<h1>Fish & <Ships>')
    expect(page).not.toContain('learns </script> tags')
    expect(page).toContain('learns \\u003C/script> tags')
    expect(
      await prettier.check(page, {
        filepath: 'apps/web/app/pages/index.vue',
        semi: false,
        singleQuote: true,
      }),
    ).toBe(true)
  })

  it('selects capabilities, keeps core implicit, and pins every manifest version', () => {
    const files = asFileMap(
      buildGeneratedFiles({
        appName: 'capability-check',
        capabilities: 'auth,seo,analytics,uploads,ai,mapkit,core',
        noGit: true,
        targetDir: '/tmp/capability-check',
      }),
    )
    const rootManifest = JSON.parse(files.get('package.json') ?? '') as Record<string, unknown>
    const webManifest = JSON.parse(files.get('apps/web/package.json') ?? '') as Record<
      string,
      unknown
    >
    const dependencies = collectVersionedDependencies(webManifest)
    const knipConfig = JSON.parse(files.get('knip.json') ?? '') as {
      ignoreDependencies: string[]
    }

    expect(rootManifest.narduk).toEqual({
      capabilities: ['auth', 'seo', 'analytics', 'uploads', 'ai', 'mapkit'],
      visibility: 'private',
    })
    expect(rootManifest.pnpm).toEqual({
      overrides: {
        '@narduk-enterprises/narduk-auth': PACKAGE_VERSIONS['@narduk-enterprises/narduk-auth'],
        '@narduk-enterprises/narduk-core': PACKAGE_VERSIONS['@narduk-enterprises/narduk-core'],
        '@nuxt/eslint': PACKAGE_VERSIONS['@nuxt/eslint'],
        'eslint-plugin-vitest>@typescript-eslint/utils':
          PACKAGE_VERSIONS['@typescript-eslint/utils'],
        esbuild: PACKAGE_VERSIONS.esbuild,
        glob: PACKAGE_VERSIONS.glob,
      },
      allowedDeprecatedVersions: {
        '@esbuild-kit/core-utils': '*',
        '@esbuild-kit/esm-loader': '*',
      },
      onlyBuiltDependencies: [
        '@parcel/watcher',
        'core-js',
        'esbuild',
        'sharp',
        'unrs-resolver',
        'vue-demi',
        'workerd',
      ],
    })
    expect(files.get('.github/workflows/ci.yml')).toContain(
      'runs-on: [self-hosted, Linux, proxmox]',
    )
    expect(dependencies['@narduk-enterprises/narduk-core']).toBe(
      PACKAGE_VERSIONS['@narduk-enterprises/narduk-core'],
    )
    expect(files.get('apps/web/nuxt.config.ts')).toContain(
      "'#narduk-db': fileURLToPath(new URL('./server/database/schema.ts', import.meta.url))",
    )
    expect(files.get('apps/web/server/utils/database.ts')).toContain(
      "import * as schema from '#narduk-db'",
    )
    expect(dependencies['@narduk-enterprises/narduk-ai']).toBe(
      PACKAGE_VERSIONS['@narduk-enterprises/narduk-ai'],
    )
    expect(dependencies['@loganrenz/narduk-mapkit']).toBe(
      PACKAGE_VERSIONS['@loganrenz/narduk-mapkit'],
    )
    expect(dependencies['@loganrenz/narduk-mapkit-nuxt']).toBe(
      PACKAGE_VERSIONS['@loganrenz/narduk-mapkit-nuxt'],
    )
    expect(dependencies['@narduk-enterprises/narduk-app-tools']).toBe(
      PACKAGE_VERSIONS['@narduk-enterprises/narduk-app-tools'],
    )
    expect(dependencies['@narduk-enterprises/narduk-testkit']).toBe(
      PACKAGE_VERSIONS['@narduk-enterprises/narduk-testkit'],
    )
    expect(Object.values(dependencies).every((version) => /^\d+\.\d+\.\d+$/u.test(version))).toBe(
      true,
    )
    expect(files.get('apps/web/nuxt.config.ts')).toContain("'@narduk-enterprises/narduk-ai'")
    expect(files.get('apps/web/nuxt.config.ts')).toContain("'@loganrenz/narduk-mapkit-nuxt'")
    expect(files.get('apps/web/nuxt.config.ts')).toContain('zeroRuntime: true')
    expect(files.get('apps/web/app/pages/index.vue')).toContain('useWebPageSchema')
    expect(knipConfig.ignoreDependencies).toContain('@loganrenz/narduk-mapkit')
  })

  it('rejects permanently unsupported capabilities with actionable guidance', () => {
    expect(() =>
      buildGeneratedFiles({ appName: 'no-pwa', capabilities: ['pwa'], targetDir: '/tmp/no-pwa' }),
    ).toThrow(/pwa.*permanently unsupported/u)
    expect(() =>
      buildGeneratedFiles({
        appName: 'no-ingestion',
        capabilities: ['ingestion'],
        targetDir: '/tmp/no-ingestion',
      }),
    ).toThrow(/future narduk-data/u)
  })

  it('enforces the onboarding-safe non-privileged local port range', () => {
    expect(() =>
      buildGeneratedFiles({ appName: 'low-port', localPort: 1023, targetDir: '/tmp/low-port' }),
    ).toThrow(/between 1024 and 65535/u)
    expect(() =>
      buildGeneratedFiles({ appName: 'high-port', localPort: 65536, targetDir: '/tmp/high-port' }),
    ).toThrow(/between 1024 and 65535/u)

    expect(
      buildGeneratedFiles({ appName: 'first-port', localPort: 1024, targetDir: '/tmp/first-port' }),
    ).not.toHaveLength(0)
    expect(
      buildGeneratedFiles({ appName: 'last-port', localPort: 65535, targetDir: '/tmp/last-port' }),
    ).not.toHaveLength(0)
  })

  it('protects non-empty directories and force preserves unrelated files', async () => {
    const targetDir = await makeTempDirectory()
    const sentinel = join(targetDir, 'keep-me.txt')
    await writeFile(sentinel, 'unrelated work\n')

    await expect(
      createNardukApp({
        appName: 'safe-app',
        noGit: true,
        targetDir,
      }),
    ).rejects.toThrow(/not empty/u)
    expect(await readFile(sentinel, 'utf8')).toBe('unrelated work\n')

    const report = await createNardukApp({
      appName: 'safe-app',
      force: true,
      noGit: true,
      targetDir,
    })
    expect(report.gitInitialized).toBe(false)
    expect(await readFile(sentinel, 'utf8')).toBe('unrelated work\n')
    expect(await readFile(join(targetDir, 'package.json'), 'utf8')).toContain('"name": "safe-app"')
  })

  it('initializes only a local git repository when git is enabled', async () => {
    const targetDir = await makeTempDirectory()
    const report = await createNardukApp({
      appName: 'local-git-app',
      targetDir,
    })

    expect(report.gitInitialized).toBe(true)
    expect((await stat(join(targetDir, '.git'))).isDirectory()).toBe(true)
  })

  it('returns a JSON report without touching external services', async () => {
    const targetDir = await makeTempDirectory()
    const chunks: string[] = []
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk))
        callback()
      },
    })
    const errorOutput = new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    })
    const fetch = vi.fn(() => {
      throw new Error('network access is forbidden')
    })
    vi.stubGlobal('fetch', fetch)

    const exitCode = await runCli({
      argv: [
        'json-app',
        '--capabilities',
        'seo,auth',
        '--no-git',
        '--json',
        '--target-dir',
        targetDir,
      ],
      cwd: process.cwd(),
      stdout: output,
      stderr: errorOutput,
    })

    expect(exitCode).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    const report = JSON.parse(chunks.join('')) as {
      appName: string
      capabilities: string[]
      packageVersions: Record<string, string>
    }
    expect(report.appName).toBe('json-app')
    expect(report.capabilities).toEqual(['auth', 'seo'])
    expect(report.packageVersions.wrangler).toBe(PACKAGE_VERSIONS.wrangler)
    expect(report.packageVersions['@playwright/test']).toBe(PACKAGE_VERSIONS['@playwright/test'])
    expect(report).toMatchObject({
      validationResults: [
        { check: 'capabilities', passed: true },
        { check: 'exact-package-versions', passed: true },
        { check: 'generated-paths', passed: true },
      ],
    })
  })

  it('emits no forbidden artifacts and parses every generated config surface', () => {
    const files = buildGeneratedFiles({
      appName: 'forbidden-check',
      capabilities: ['auth', 'seo', 'analytics', 'uploads', 'ai', 'mapkit'],
      noGit: true,
      targetDir: '/tmp/forbidden-check',
    })
    const paths = files.map((file) => file.path)
    const forbiddenPaths = [
      '.template-reference',
      '.template-version',
      'narduk.layout.json',
      'scripts/narduk-toolchain.mjs',
      'provision.json',
      'guardrail-exceptions.json',
      'create-narduk-app-report.json',
      '.setup-complete',
      'public/sw.js',
      'public/offline.html',
      'public/site.webmanifest',
      'server/ingestion/jobs.ts',
      'server/cron/ledger.ts',
    ]

    expect(forbiddenPaths.some((forbidden) => paths.includes(forbidden))).toBe(false)
    expect(paths.some((path) => /(?:^|\/)(?:sync|reconcile|drift)(?:\/|\.)/u.test(path))).toBe(
      false,
    )
    expect(paths.some((path) => /service-worker|offline/u.test(path))).toBe(false)
    expect(paths.some((path) => path.includes('command'))).toBe(false)
    expect(paths).toContain('.npmrc')

    const generatedText = files.map((file) => file.contents).join('\n')
    expect(generatedText).not.toContain('postinstall')
    expect(generatedText).not.toContain('git+')
    expect(generatedText).not.toContain('provision.json')
    expect(files.find((file) => file.path === '.npmrc')?.contents).toBe(
      '@narduk-enterprises:registry=https://npm.pkg.github.com\n' +
        '@loganrenz:registry=https://registry.npmjs.org/\n' +
        '//npm.pkg.github.com/:_authToken=${NARDUK_PLATFORM_GH_PACKAGES_READ-UNCONFIGURED}\n',
    )
    expect(files.find((file) => file.path === '.github/workflows/ci.yml')?.contents).toContain(
      'pnpm install --frozen-lockfile',
    )
    expect(files.find((file) => file.path === '.github/workflows/ci.yml')?.contents).toContain(
      '${{ secrets.NARDUK_PLATFORM_GH_PACKAGES_READ }}',
    )
    expect(files.find((file) => file.path === '.github/workflows/ci.yml')?.contents).toContain(
      'NARDUK_PLATFORM_GH_PACKAGES_READ: ${{ secrets.NARDUK_PLATFORM_GH_PACKAGES_READ }}',
    )

    for (const file of files.filter((file) => file.path.endsWith('.json'))) {
      expect(() => JSON.parse(file.contents), file.path).not.toThrow()
    }
    for (const file of files.filter(
      (file) => file.path.endsWith('.ts') || file.path.endsWith('.mjs'),
    )) {
      expect(
        () =>
          ts.transpileModule(file.contents, { compilerOptions: { module: ts.ModuleKind.ESNext } }),
        file.path,
      ).not.toThrow()
    }
  })

  it('emits files already canonical under the generated Prettier contract', async () => {
    const files = buildGeneratedFiles({
      appName: 'format-check',
      capabilities: ['auth', 'seo', 'analytics', 'uploads', 'ai', 'mapkit'],
      noGit: true,
      targetDir: '/tmp/format-check',
    })
    const supported = /\.(?:css|json|jsonc|md|mjs|ts|vue|ya?ml)$/u

    for (const file of files.filter((candidate) => supported.test(candidate.path))) {
      expect(
        await prettier.check(file.contents, {
          endOfLine: 'lf',
          filepath: file.path,
          printWidth: 100,
          semi: false,
          singleQuote: true,
          trailingComma: 'all',
        }),
        file.path,
      ).toBe(true)
    }
  })

  it('writes a generated fixture with app-owned workspace and direct quality scripts', async () => {
    const targetDir = await makeTempDirectory()
    await createNardukApp({
      appName: 'generated-fixture',
      capabilities: ['auth', 'uploads'],
      description: 'Fixture app',
      displayName: 'Generated Fixture',
      localPort: 4377,
      noGit: true,
      targetDir,
    })

    const files = await readdir(targetDir, { recursive: true })
    expect(files).toContain('apps')
    expect(files).toContain('apps/web')
    expect(files).toContain('apps/web/package.json')
    expect(files).toContain('apps/web/nuxt.config.ts')
    expect(
      JSON.parse(await readFile(join(targetDir, 'apps/web/migrations.sources.json'), 'utf8')),
    ).toMatchObject({
      schemaVersion: 1,
      sources: [
        {
          id: '@narduk-enterprises/narduk-core',
          dir: 'node_modules/@narduk-enterprises/narduk-core/runtime/drizzle',
        },
        {
          id: '@narduk-enterprises/narduk-auth',
          dir: 'node_modules/@narduk-enterprises/narduk-auth/drizzle',
        },
        { id: 'app', dir: 'drizzle' },
      ],
    })
    const rootPackage = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(rootPackage.scripts.quality).toContain('pnpm run format:check')
    expect(rootPackage.scripts.quality).toContain('pnpm run knip')
    expect(rootPackage.scripts.build).toContain('pnpm --filter web')
    expect(rootPackage.scripts.test).toContain('playwright')
    expect(rootPackage.scripts['cf:build']).toBe('pnpm --filter web run cf:build')
    expect(rootPackage.scripts['cf:deploy']).toBe('pnpm --filter web run cf:deploy')
    expect(rootPackage.scripts.deploy).toBe('pnpm --filter web run deploy')
    const knipConfig = JSON.parse(await readFile(join(targetDir, 'knip.json'), 'utf8')) as {
      ignoreDependencies: string[]
    }
    expect(knipConfig.ignoreDependencies).not.toContain('@loganrenz/narduk-mapkit')
    const webPackage = JSON.parse(
      await readFile(join(targetDir, 'apps/web/package.json'), 'utf8'),
    ) as {
      description: string
      homepage: string
      narduk: Record<string, unknown>
      scripts: Record<string, string>
    }
    expect(webPackage.description).toBe('Fixture app')
    expect(webPackage.homepage).toBe('http://localhost:4377')
    expect(webPackage.narduk).toMatchObject({
      name: 'generated-fixture',
      displayName: 'Generated Fixture',
      shortName: 'Generated Fixture',
      url: 'http://localhost:4377',
      localDevNuxtPort: 4377,
    })
    expect(webPackage.scripts['db:migrate:local']).toContain('narduk-app db migrate')
    expect(webPackage.scripts.dev).toBe(
      'narduk-app dev --project generated-fixture --config dev -- nuxt dev --host 127.0.0.1',
    )
    expect(webPackage.scripts['dev:test']).toBe('nuxt dev --host 127.0.0.1')
    expect(webPackage.scripts['cf:deploy']).toContain('narduk-app db migrate')
    expect(webPackage.scripts['cf:deploy']).toContain('--workers-build-only')
    expect(webPackage.scripts.deploy).toBe('narduk-app deploy deploy')
    expect(webPackage.scripts['deploy:dry-run']).toBe('narduk-app deploy deploy --dry-run')
    expect(webPackage.scripts['performance-budget']).toContain('--font-total-budget-kb 140')
    expect(await readFile(join(targetDir, 'apps/web/app/app.vue'), 'utf8')).toContain('<UApp>')
    expect(await readFile(join(targetDir, 'apps/web/app/app.vue'), 'utf8')).toContain(
      '<NuxtLayout>',
    )
    const generatedCi = await readFile(join(targetDir, '.github/workflows/ci.yml'), 'utf8')
    expect(generatedCi).toContain('actions/checkout@v7')
    expect(generatedCi).toContain('pnpm/action-setup@v6')
    expect(generatedCi).toContain('actions/setup-node@v7')
    expect(generatedCi).not.toMatch(/actions\/(?:checkout|setup-node)@v4/u)
    const wranglerConfig = await readFile(join(targetDir, 'apps/web/wrangler.jsonc'), 'utf8')
    expect(wranglerConfig).toContain('"no_bundle": true')
    expect(wranglerConfig).toContain('"find_additional_modules": true')
    expect(wranglerConfig).toContain('"base_dir": ".output/server"')
    expect(await readFile(join(targetDir, 'playwright.config.ts'), 'utf8')).toContain(
      'NUXT_SESSION_PASSWORD=narduk-test-only-session-password-000000',
    )
    expect(
      await readFile(join(targetDir, 'apps/web/drizzle/0000_app_records.sql'), 'utf8'),
    ).toContain('CREATE TABLE `app_records`')
    expect(await stat(join(targetDir, 'apps/web/wrangler.jsonc'))).toBeDefined()
  })
})

describe('CLI argument parsing', () => {
  it('supports named options and exact local target resolution', async () => {
    const parsed = (await import('../src/cli.js')).parseCliArguments(
      ['--name', 'named-app', '--target-dir', 'output', '--local-dev-port=3456', '--no-git'],
      '/workspace',
    )
    expect(parsed.options.appName).toBe('named-app')
    expect(parsed.options.targetDir).toBe('/workspace/output')
    expect(parsed.options.localPort).toBe(3456)
    expect(parsed.options.noGit).toBe(true)
  })

  it('prints help without generating files', async () => {
    const chunks: string[] = []
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk))
        callback()
      },
    })
    const code = await runCli({ argv: ['--help'], stdout: output })
    expect(code).toBe(0)
    expect(chunks.join('')).toContain('create-narduk-app')
  })
})
