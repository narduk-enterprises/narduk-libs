import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

import * as prettier from 'prettier'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as YAML from 'yaml'

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
  it.each([{ capability: [] }, { capability: ['seo'] }])(
    'includes the share-preview gate with capabilities $capability',
    ({ capability }) => {
      const files = asFileMap(
        buildGeneratedFiles({
          appName: 'shareable-app',
          capabilities: capability,
          targetDir: '/tmp/shareable-app',
          siteUrl: 'https://example.com',
        }),
      )
      const config = JSON.parse(files.get('apps/web/Config/social-previews.json') ?? '{}')
      const manifest = JSON.parse(files.get('apps/web/package.json') ?? '{}')
      expect(config.defaultImage).toMatchObject({ path: '/og.png', source: 'public/og-source.svg' })
      expect(config.routes).toContainEqual({ source: 'index.vue', kind: 'default', paths: ['/'] })
      expect(files.get('apps/web/public/og-source.svg')).toContain('width="1200" height="630"')
      expect(files.get('apps/web/public/og-source.svg')).toContain('Shareable App')
      expect(manifest.scripts.build).toContain('og:check && nuxt build')
      expect(manifest.scripts['cf:build']).toContain('og:check && nuxt build')
      expect(files.get('apps/web/tests/e2e/social-previews.spec.ts')).toContain(
        'checkSocialPreviews',
      )
      expect(files.get('apps/web/nuxt.config.ts')).toContain(
        capability.includes('seo') ? 'defaultOgImage' : 'og:image',
      )
    },
  )

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
    expect(first.get('.github/workflows/ci.yml')).toContain('runs-on: ubuntu-24.04')
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
    expect(dependencies['@narduk-enterprises/narduk-logging']).toBe(
      PACKAGE_VERSIONS['@narduk-enterprises/narduk-logging'],
    )
    expect(files.get('apps/web/nuxt.config.ts')).toContain('nardukLogging: {')
    expect(files.get('apps/web/nuxt.config.ts')).toContain("service: 'capability-check'")
    expect(files.get('apps/web/nuxt.config.ts')).toContain("level: 'info'")
    expect(files.get('apps/web/nuxt.config.ts')).toContain('requestLogging: true')
    expect(files.get('docs/logging.md')).toContain('useLogger(event)')
    const knipConfig = JSON.parse(files.get('knip.json') ?? '') as {
      ignoreDependencies: string[]
    }

    expect(rootManifest.narduk).toEqual({
      capabilities: ['auth', 'seo', 'analytics', 'uploads', 'ai', 'mapkit'],
      visibility: 'private',
    })
    expect(rootManifest.pnpm).toEqual({
      overrides: {
        '@narduk-enterprises/narduk-core': PACKAGE_VERSIONS['@narduk-enterprises/narduk-core'],
        '@narduk-enterprises/narduk-logging':
          PACKAGE_VERSIONS['@narduk-enterprises/narduk-logging'],
        '@narduk-enterprises/narduk-mapkit': PACKAGE_VERSIONS['@narduk-enterprises/narduk-mapkit'],
        '@nuxt/eslint': PACKAGE_VERSIONS['@nuxt/eslint'],
        '@nuxt/kit': PACKAGE_VERSIONS.nuxt,
        'eslint-plugin-vitest>@typescript-eslint/utils':
          PACKAGE_VERSIONS['@typescript-eslint/utils'],
        esbuild: PACKAGE_VERSIONS.esbuild,
        glob: PACKAGE_VERSIONS.glob,
        'nuxt-og-image': PACKAGE_VERSIONS['nuxt-og-image'],
      },
      peerDependencyRules: {
        // nuxt-auth-utils' optional passkey helpers still peer on
        // `@simplewebauthn/*@^11`; narduk-auth ships its own exact-pinned v13
        // and never calls them (narduk-libs#125 D3).
        allowAny: ['@simplewebauthn/browser', '@simplewebauthn/server'],
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
    expect(files.get('.github/workflows/ci.yml')).toContain('"group":"linux-ci"')
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
    expect(dependencies['@narduk-enterprises/narduk-mapkit']).toBe(
      PACKAGE_VERSIONS['@narduk-enterprises/narduk-mapkit'],
    )
    expect(dependencies['@narduk-enterprises/narduk-mapkit-nuxt']).toBe(
      PACKAGE_VERSIONS['@narduk-enterprises/narduk-mapkit-nuxt'],
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
    expect(files.get('apps/web/nuxt.config.ts')).toContain(
      "'@narduk-enterprises/narduk-mapkit-nuxt'",
    )
    expect(files.get('apps/web/nuxt.config.ts')).toContain('zeroRuntime: true')
    expect(files.get('apps/web/app/pages/index.vue')).toContain('useWebPageSchema')
    expect(knipConfig.ignoreDependencies).toContain('@narduk-enterprises/narduk-mapkit')
    // narduk-libs#123: the mapkit capability must never scaffold the dead
    // @narduk-geo scope (superseded by @narduk-enterprises/narduk-mapkit@2.x).
    expect([...files.values()].some((contents) => contents.includes('@narduk-geo'))).toBe(false)
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
    // narduk-libs#172 siblings: the committed .npmrc is scope routing ONLY.
    // pnpm 10 warns 'Failed to replace env in config' on an unresolved
    // ${VAR} and pnpm 11 removes .npmrc env interpolation outright, so the
    // file must carry no _authToken line at all -- not even an env reference.
    expect(files.find((file) => file.path === '.npmrc')?.contents).toBe(
      '@narduk-enterprises:registry=https://npm.pkg.github.com\n',
    )
    // Private apps delegate install/cleanup and the fail-closed aggregate to
    // the pinned shared workflow; the public renderer is exercised separately.
    expect(files.find((file) => file.path === '.github/workflows/ci.yml')?.contents).toContain(
      'nuxt-cloudflare.yml@9070db7244649bf192d392a5b96eb1656997c84c',
    )
    expect(files.find((file) => file.path === '.github/workflows/ci.yml')?.contents).toContain(
      'NARDUK_PLATFORM_GH_PACKAGES_READ: ${{ secrets.NARDUK_PLATFORM_GH_PACKAGES_READ }}',
    )
    // One credential, two names: the org secret maps into the single process
    // env name the committed .npmrc reads. No second alias, and no setup-node
    // registry-url writing a competing userconfig .npmrc (company-hq#488).
    const generatedCi =
      files.find((file) => file.path === '.github/workflows/ci.yml')?.contents ?? ''
    expect(generatedCi).not.toContain('NODE_AUTH_TOKEN')
    expect(generatedCi).not.toContain('registry-url')
    expect(generatedText).not.toContain('NODE_AUTH_TOKEN')
    expect(generatedText).not.toContain('NPM_TOKEN')
    expect(generatedText).not.toContain('GH_PACKAGES_TOKEN')

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

  it('does not scaffold an app-local health route that shadows narduk-core /api/health', () => {
    // narduk-core is always an implicit module (moduleList()) and registers
    // `runtime/server/api/health.get.ts` via addServerScanDir — a real
    // DB-probing health check. Nitro resolves an app-local
    // `server/api/*` file before a module's addServerScanDir contribution
    // with the same route, so a generated `apps/web/server/api/health.get.ts`
    // stub would silently shadow narduk-core's real check with a trivial
    // `{ ok: true }` response in every scaffolded app. Regression coverage
    // for that shadowing bug.
    const files = buildGeneratedFiles({
      appName: 'health-shadow-check',
      capabilities: [],
      noGit: true,
      targetDir: '/tmp/health-shadow-check',
    })
    const paths = files.map((file) => file.path)

    expect(paths).not.toContain('apps/web/server/api/health.get.ts')
    expect(paths.some((path) => /(?:^|\/)server\/api\/health\.get\.ts$/u.test(path))).toBe(false)
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
    expect(rootPackage.scripts['quality:static']).toContain('pnpm run format:check')
    expect(rootPackage.scripts['quality:static']).toContain('pnpm run knip')
    expect(rootPackage.scripts.build).toContain('pnpm --filter web')
    expect(rootPackage.scripts.test).toContain('playwright')
    expect(rootPackage.scripts['cf:build']).toBe('pnpm --filter web run cf:build')
    expect(rootPackage.scripts['cf:deploy']).toBe('pnpm --filter web run cf:deploy')
    expect(rootPackage.scripts.deploy).toBe('pnpm --filter web run deploy')
    const knipConfig = JSON.parse(await readFile(join(targetDir, 'knip.json'), 'utf8')) as {
      ignoreDependencies: string[]
    }
    expect(knipConfig.ignoreDependencies).not.toContain('@narduk-enterprises/narduk-mapkit')
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
    expect(webPackage.scripts['dev:test']).toBe(
      'narduk-app og:generate --if-missing && nuxt dev --host 127.0.0.1',
    )
    expect(webPackage.scripts['cf:deploy']).toContain('narduk-app db migrate')
    expect(webPackage.scripts['cf:deploy']).toContain('--workers-build-only')
    expect(webPackage.scripts.deploy).toBe('narduk-app deploy deploy')
    expect(webPackage.scripts['deploy:dry-run']).toBe('narduk-app deploy deploy --dry-run')
    expect(webPackage.scripts['performance-budget']).toContain('--font-total-budget-kb 140')
    expect(await readFile(join(targetDir, 'apps/web/app/app.vue'), 'utf8')).toContain('<UApp>')
    expect(await readFile(join(targetDir, 'apps/web/app/app.vue'), 'utf8')).toContain(
      '<NuxtLayout>',
    )
    const generatedNuxtConfig = await readFile(join(targetDir, 'apps/web/nuxt.config.ts'), 'utf8')
    expect(generatedNuxtConfig.indexOf("'@narduk-enterprises/narduk-core'")).toBeLessThan(
      generatedNuxtConfig.indexOf("'@nuxt/ui'"),
    )
    const generatedCi = await readFile(join(targetDir, '.github/workflows/ci.yml'), 'utf8')
    expect(generatedCi).toContain('nuxt-cloudflare.yml@9070db7244649bf192d392a5b96eb1656997c84c')
    expect(generatedCi).toContain('require-scripts: true')
    expect(generatedCi).toContain('run-tests: true')
    expect(generatedCi).toContain('run-e2e: true')
    expect(generatedCi).not.toMatch(/@v\d/u)
    const wranglerConfig = await readFile(join(targetDir, 'apps/web/wrangler.jsonc'), 'utf8')
    expect(wranglerConfig).toContain('"no_bundle": true')
    expect(wranglerConfig).toContain('"find_additional_modules": true')
    expect(wranglerConfig).toContain('"base_dir": ".output/server"')
    const generatedPlaywrightConfig = await readFile(
      join(targetDir, 'playwright.config.ts'),
      'utf8',
    )
    expect(generatedPlaywrightConfig).toContain(
      'NUXT_SESSION_PASSWORD=narduk-test-only-session-password-000000',
    )
    // narduk-libs#62: the port must be overridable by PLAYWRIGHT_PORT and
    // flow into baseURL, the webServer url, AND the webServer command's PORT
    // env — otherwise two concurrent worktrees silently attach to the same
    // fixed port and one test run exercises the other lane's app.
    expect(generatedPlaywrightConfig).toContain(
      'const port = Number(process.env.PLAYWRIGHT_PORT) || 4377',
    )
    expect(generatedPlaywrightConfig).toContain('baseURL: `http://127.0.0.1:${port}`')
    expect(generatedPlaywrightConfig).toContain('url: `http://127.0.0.1:${port}`')
    expect(generatedPlaywrightConfig).toContain('`PORT=${port} NUXT_SESSION_PASSWORD=')
    expect(
      await readFile(join(targetDir, 'apps/web/drizzle/0000_app_records.sql'), 'utf8'),
    ).toContain('CREATE TABLE `app_records`')
    expect(await stat(join(targetDir, 'apps/web/wrangler.jsonc'))).toBeDefined()
  })
})

describe('generated app typecheck and lint surfaces', () => {
  const capabilitySets: Array<{ capabilities: string[]; label: string }> = [
    { capabilities: [], label: 'core-only' },
    { capabilities: ['auth'], label: 'auth-only' },
    { capabilities: ['analytics', 'uploads', 'ai', 'mapkit'], label: 'no-seo capabilities' },
    { capabilities: ['seo'], label: 'seo-only' },
    {
      capabilities: ['auth', 'seo', 'analytics', 'uploads', 'ai', 'mapkit'],
      label: 'every capability',
    },
  ]

  function generate(capabilities: string[]): Map<string, string> {
    return asFileMap(
      buildGeneratedFiles({
        appName: 'surface-check',
        capabilities,
        noGit: true,
        targetDir: '/tmp/surface-check',
      }),
    )
  }

  // narduk-libs#172: `site` is a nuxt-site-config key that only reaches the app
  // through @nuxtjs/seo. Emitting it for every capability set made a core-only
  // or auth-only scaffold fail `nuxt typecheck` with TS2353 on its first run.
  it('emits the nuxt-site-config `site` block only for an seo scaffold', () => {
    for (const { capabilities, label } of capabilitySets) {
      const nuxtConfig = generate(capabilities).get('apps/web/nuxt.config.ts') ?? ''
      const hasSeo = capabilities.includes('seo')

      expect(nuxtConfig.includes('  site: {'), label).toBe(hasSeo)
      expect(nuxtConfig.includes('zeroRuntime: true'), label).toBe(hasSeo)
      expect(nuxtConfig.includes("routeRules: { '/': { prerender: true } }"), label).toBe(hasSeo)
      // The consts the seo block reads stay used by runtimeConfig either way, so
      // dropping the block never leaves an unused binding behind.
      expect(nuxtConfig).toContain('      appName,')
      expect(nuxtConfig).toContain('      siteUrl,')
    }
  })

  // The shared eslint config's type-aware pack resolves each file through the
  // nearest tsconfig.json. apps/web/tsconfig.json extends .nuxt/tsconfig.json,
  // whose include excludes server/**, so without this file the first server
  // directory an app adds fails lint with "was not found by the project
  // service".
  it('emits a server tsconfig for every capability set', () => {
    for (const { capabilities, label } of capabilitySets) {
      const files = generate(capabilities)

      expect([...files.keys()], label).toContain('apps/web/server/tsconfig.json')
      expect(files.get('apps/web/server/tsconfig.json'), label).toBe(
        '{\n  "extends": "../.nuxt/tsconfig.server.json"\n}\n',
      )
    }
  })

  it('keeps registry auth out of the committed .npmrc for every capability set', () => {
    for (const { capabilities, label } of capabilitySets) {
      const files = generate(capabilities)
      const npmrc = files.get('.npmrc') ?? ''
      const ci = files.get('.github/workflows/ci.yml') ?? ''
      const readme = files.get('README.md') ?? ''

      expect(npmrc, label).toBe('@narduk-enterprises:registry=https://npm.pkg.github.com\n')
      expect(npmrc, label).not.toContain('_authToken')
      expect(npmrc, label).not.toContain('${')
      expect(ci, label).toContain('nuxt-cloudflare.yml@9070db7244649bf192d392a5b96eb1656997c84c')
      expect(ci, label).toContain(
        'NARDUK_PLATFORM_GH_PACKAGES_READ: ${{ secrets.NARDUK_PLATFORM_GH_PACKAGES_READ }}',
      )
      // The retired Doppler/nvault fallback wording is gone; the README now
      // documents the process-scoped path only.
      expect(readme, label).not.toContain('narduk/tokens:GH_PACKAGES_READ')
      expect(readme, label).toContain('NPM_CONFIG_USERCONFIG')
      expect(readme, label).toContain('gh-packages-run')
      expect(readme, label).toContain('org Dependabot secret store')
      expect(readme, label).toContain('selected repositories')
    }
  })

  // components-library-plan.md #2 item 6 (narduk-libs#253): one Dependabot
  // group for @narduk-enterprises/* so a fleet-wide bump of narduk-shell /
  // narduk-ui / narduk-charts / narduk-core etc. lands as one PR per app
  // (matches foundation:check item 5.2's existing "grouping .github/
  // dependabot.yml" acceptance shape, narduk-libs#233).
  it('emits a .github/dependabot.yml grouping @narduk-enterprises/* through the existing GitHub Packages registry', () => {
    for (const { capabilities, label } of capabilitySets) {
      const files = generate(capabilities)
      const dependabot = files.get('.github/dependabot.yml') ?? ''

      expect(dependabot, label).toContain("package-ecosystem: 'npm'")
      expect(dependabot, label).toContain('narduk-libs:')
      expect(dependabot, label).toContain("- '@narduk-enterprises/*'")
      // Reuses the same registry URL as the committed .npmrc and the same
      // org Actions secret name already used for install auth -- no new
      // registry or credential name invented for Dependabot.
      expect(dependabot, label).toContain('url: https://npm.pkg.github.com')
      expect(dependabot, label).toContain('${{secrets.NARDUK_PLATFORM_GH_PACKAGES_READ}}')
      expect(() => YAML.parse(dependabot), label).not.toThrow()
      const parsed = YAML.parse(dependabot) as {
        version: number
        registries: Record<string, { type: string; url: string }>
        updates: Array<{
          directories?: string[]
          directory?: string
          registries: string[]
          groups: Record<string, { patterns: string[] }>
        }>
      }
      expect(parsed.version, label).toBe(2)
      expect(parsed.updates[0].directory, label).toBeUndefined()
      expect(parsed.updates[0].directories, label).toEqual(['/', '/apps/*'])
      expect(parsed.updates[0].registries, label).toEqual(['narduk-github-packages'])
      expect(parsed.updates[0].groups['narduk-libs'].patterns, label).toEqual([
        '@narduk-enterprises/*',
      ])
      expect(files.has('renovate.json'), label).toBe(false)
    }
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
