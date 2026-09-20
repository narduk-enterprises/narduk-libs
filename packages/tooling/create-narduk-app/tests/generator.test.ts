import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

import * as prettier from 'prettier'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as YAML from 'yaml'

import { buildGeneratedFiles, createNardukApp, PACKAGE_VERSIONS, runCli } from '../src/index.js'

/**
 * The block `narduk-app-tools` hands a new app, read by relative path rather
 * than imported.
 *
 * This generator must not depend on `narduk-app-tools` -- a published
 * `create-narduk-app` requires nothing at runtime -- and a development
 * dependency would not survive CI either, whose per-package gates run
 * `pnpm --filter <name>` without building a workspace sibling's `dist`. The
 * fixture is the pin instead: `narduk-app-tools`' own suite asserts it equals
 * `defaultDeploymentBlock()` and that `readDeploymentBlock` accepts it, so a
 * schema change cannot reach this assertion without going through that one.
 */
const CANONICAL_DEPLOYMENT_BLOCK = new URL(
  '../../narduk-app-tools/fixtures/default-deployment-block.json',
  import.meta.url,
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
  it.each(['private', 'public'] as const)(
    'uses one supported Node runtime in %s apps',
    (visibility) => {
      const files = asFileMap(
        buildGeneratedFiles({
          appName: 'node-runtime',
          capabilities: [],
          visibility,
          targetDir: '/tmp/node-runtime',
        }),
      )
      const manifest = JSON.parse(files.get('package.json') ?? '{}')
      // `.node-version` is the declared source; `engines`/`volta` are the two
      // mirrors Volta and npm can read from nowhere else. No `.nvmrc`: see
      // ownership.ts NODE_SOURCE_FILE.
      expect(files.get('.node-version')?.trim()).toBe('24.21.0')
      expect(manifest.engines.node).toBe(files.get('.node-version')?.trim())
      expect(manifest.volta.node).toBe(manifest.engines.node)
      expect(files.has('.nvmrc')).toBe(false)
      // CI carries NO Node literal at all -- it points at the source instead.
      const workflow = YAML.parse(files.get('.github/workflows/ci.yml') ?? '')
      const withBlocks = Object.values(
        workflow.jobs as Record<
          string,
          {
            with?: Record<string, unknown>
            steps?: Array<{ with?: Record<string, unknown> }>
          }
        >,
      ).flatMap((job) => [job.with, ...(job.steps ?? []).map((step) => step.with)])
      const files_ = withBlocks.map((block) => block?.['node-version-file']).filter(Boolean)
      expect(files_.length).toBeGreaterThan(0)
      expect(files_.every((value) => value === '.node-version')).toBe(true)
      expect(withBlocks.some((block) => block?.['node-version'] !== undefined)).toBe(false)
    },
  )

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

  it('preserves an explicit deployment target before inferring a branch preview', () => {
    const files = asFileMap(
      buildGeneratedFiles({
        appName: 'preview-aware-app',
        capabilities: ['seo'],
        targetDir: '/tmp/preview-aware-app',
      }),
    )
    const config = files.get('apps/web/nuxt.config.ts') ?? ''
    expect(config).toContain(
      "process.env.NARDUK_DEPLOY_TARGET || (isBranchPreview ? 'preview' : 'production')",
    )
    expect(config).toContain('process.env.NARDUK_DEPLOY_TARGET ??= deploymentTarget')
    expect(config).not.toContain('hostAwareIndexing: true')
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

  it.each(['private', 'public'] as const)(
    'ignores Wrangler .dev.vars secrets in the generated %s .gitignore',
    (visibility) => {
      const files = asFileMap(
        buildGeneratedFiles({
          appName: 'gitignore-secrets',
          capabilities: [],
          noGit: true,
          targetDir: '/tmp/gitignore-secrets',
          visibility,
        }),
      )
      const gitignore = files.get('.gitignore') ?? ''
      expect(gitignore).toContain('.env\n')
      expect(gitignore).toContain('.env.*\n')
      expect(gitignore).toContain('!.env.example\n')
      expect(gitignore).toContain('.dev.vars\n')
      expect(gitignore).toContain('**/.dev.vars\n')
      expect(gitignore).toContain('.dev.vars.*\n')
      expect(gitignore).toContain('!.dev.vars.example\n')
    },
  )

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
    // @nuxt/icon must be an exact-pinned direct devDependency, not only a
    // transitive install pulled in by @nuxt/ui: see the moduleList()
    // regression coverage above for why (UNLOADABLE_DEPENDENCY build
    // failure this audit found and fixed).
    expect(dependencies['@nuxt/icon']).toBe(PACKAGE_VERSIONS['@nuxt/icon'])
    expect((webManifest.devDependencies as Record<string, string>)['@nuxt/icon']).toBe(
      PACKAGE_VERSIONS['@nuxt/icon'],
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
        '@narduk-enterprises/narduk-platform':
          PACKAGE_VERSIONS['@narduk-enterprises/narduk-platform'],
        '@nuxt/eslint': PACKAGE_VERSIONS['@nuxt/eslint'],
        '@nuxt/kit': PACKAGE_VERSIONS.nuxt,
        'eslint-plugin-vitest>@typescript-eslint/utils':
          PACKAGE_VERSIONS['@typescript-eslint/utils'],
        esbuild: PACKAGE_VERSIONS.esbuild,
        glob: PACKAGE_VERSIONS.glob,
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
    expect(dependencies.nuxt).toBe('4.5.2')
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
      'nuxt-cloudflare.yml@6f56678ad7562234e465284e48f27008e0f32db7',
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
    // `runtime/server/api/health.get.ts` via addServerScanDir: the shared
    // health report, which probes the declared database (or reports it
    // not_applicable for databaseBackend 'none') and runs the checks apps add
    // with registerHealthCheck. Nitro resolves an app-local `server/api/*`
    // file before a module's addServerScanDir contribution with the same
    // route, so a generated `apps/web/server/api/health.get.ts` stub would
    // silently shadow that report with a trivial `{ ok: true }` response in
    // every scaffolded app. Apps extend health with registerHealthCheck
    // instead. Regression coverage for that shadowing bug.
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

  // Buoys-parity audit (narduk-libs#D2): every surface below was a gap the
  // generator has just closed. One dedicated assertion per changed template
  // so a future regression in any of them fails here, not only in the
  // broader Prettier-canonical/forbidden-artifact sweeps above.
  it('emits every generator-parity template added for Buoys-shape parity', () => {
    for (const { capabilities, hasDatabase, hasAuth, label } of [
      { capabilities: ['auth', 'seo'], hasDatabase: true, hasAuth: true, label: 'auth+db' },
      {
        capabilities: ['seo'] as string[],
        hasDatabase: true,
        hasAuth: false,
        label: 'db, no auth',
      },
      {
        capabilities: [] as string[],
        hasDatabase: false,
        hasAuth: false,
        label: 'no-db no-auth',
      },
    ]) {
      const files = buildGeneratedFiles({
        appName: 'parity-fixture',
        capabilities,
        databaseBackend: hasDatabase ? 'd1' : 'none',
        noGit: true,
        targetDir: '/tmp/parity-fixture',
      })
      const byPath = asFileMap(files)

      // .github/workflows/copilot-setup-steps.yml: emitted unconditionally
      // (both visibilities); createCopilotSetupWorkflow() itself is covered
      // in ci-workflow.test.ts, so this only proves it is actually wired
      // into buildGeneratedFiles()'s output.
      const copilotWorkflow = byPath.get('.github/workflows/copilot-setup-steps.yml')
      expect(copilotWorkflow, label).toBeDefined()
      expect(copilotWorkflow, label).toContain('workflow_dispatch:')
      expect(copilotWorkflow, label).toContain('runs-on: ubuntu-latest')

      // CONTRACT.md: generic skeleton, conditioned on hasDatabase and the
      // auth capability.
      const contract = byPath.get('CONTRACT.md')
      expect(contract, label).toBeDefined()
      expect(contract, label).toContain('# API Contract')
      expect(contract, label).toContain(
        '| GET    | `/api/health` | Narduk-core shared health report |',
      )
      if (hasDatabase) {
        expect(contract, label).toContain('A required database check reports connectivity')
      } else {
        expect(contract, label).toContain("declares `databaseBackend: 'none'`")
        expect(contract, label).toContain('data.database: "not_applicable"')
      }
      if (hasAuth) {
        expect(contract, label).toContain('This app includes the auth capability')
      } else {
        expect(contract, label).toContain('Strategy: none by default')
      }

      // docs/workers-builds.md: generic Cloudflare connection runbook with
      // explicit TODO(onboarding) markers for the genuinely live parts.
      const runbook = byPath.get('docs/workers-builds.md')
      expect(runbook, label).toBeDefined()
      expect(runbook, label).toContain('## Cloudflare connection')
      expect(runbook, label).toContain(
        '| Build command                 | `pnpm run cf:build`                                   |',
      )
      expect(runbook, label).toContain(
        '| `SKIP_DEPENDENCY_INSTALL`     | `1`                                                   |',
      )
      expect(runbook, label).toContain('`NUXT_OG_IMAGE_SECRET`')
      expect(runbook, label).toContain(
        '| `NUXT_OG_IMAGE_SECRET`        | Build variable (Worker secrets are runtime-only)      |',
      )
      expect(runbook, label).toContain('`NUXT_SESSION_PASSWORD`')
      expect(runbook, label).toContain('scripts/gh-packages-run.mjs')
      expect(runbook, label).toContain('frozen workspace lockfile')
      expect(runbook, label).toContain('TODO(onboarding):')

      // The deployment standard: a build uploads a version and deploys
      // nothing, so BOTH Cloudflare deploy commands must be the upload one --
      // a production command that deploys puts a `main` push straight into
      // production, which is the failure the standard exists to prevent.
      expect(runbook, label).toContain(
        '| Production deploy command     | `pnpm run cf:deploy:preview`                          |',
      )
      expect(runbook, label).toContain(
        '| Non-production deploy command | `pnpm run cf:deploy:preview`                          |',
      )
      expect(runbook, label).toContain('## The deployment standard')
      expect(runbook, label).toContain('"standard": "narduk-v1"')
      expect(runbook, label).toContain(
        '"productionDeployCommand": "narduk-app deploy versions-upload"',
      )
      // Branch builds start OFF: a preview binds the Worker's production D1,
      // KV and R2, so turning them on before preview bindings exist would let
      // every pull request write production data.
      expect(runbook, label).toContain('"nonProductionBranchBuilds": false')
      expect(runbook, label).toContain(
        '| Non-production branch builds  | disabled until preview bindings exist (see below)     |',
      )
      expect(runbook, label).toContain('"previewBindings"')
      expect(runbook, label).toContain('narduk-app foundation:check:deployment')
      // narduk-libs#451 defect 2: under `on: workflow_run` GITHUB_SHA is the
      // default branch head at trigger time, not the commit whose run went
      // green, so a snippet that passes it can promote a commit the gate check
      // never saw. The runbook must show the triggering commit and must not
      // hand anyone `$GITHUB_SHA` to copy.
      expect(runbook, label).toContain('narduk-app deploy versions-promote --sha "$VERIFIED_SHA"')
      expect(runbook, label).toContain('${{ github.event.workflow_run.head_sha }}')
      expect(runbook, label).not.toContain('--sha "$GITHUB_SHA"')
      expect(runbook, label).not.toContain('--expect-sha "$GITHUB_SHA"')
      // The generator writes the app's own half of Config/cloudflare-app.json
      // and still emits the `deployment` block for onboarding to paste in.
      // Without the file, foundation:check item 1.2 is a decided FAIL on
      // every brand-new app and CI's `foundation-check: true` input fails the
      // build, so the first CI run was red by construction (narduk-libs#617).
      const cloudflareApp = byPath.get('Config/cloudflare-app.json')
      expect(cloudflareApp, label).toBeDefined()
      const declared = JSON.parse(cloudflareApp ?? '{}') as Record<string, never>
      expect(declared, label).toMatchObject({
        schemaVersion: 1,
        worker: {
          nitroPreset: 'cloudflare_module',
          wranglerConfig: 'apps/web/wrangler.jsonc',
          // The same pair wrangler.jsonc sets: closed for an authenticated
          // app, open for a public one. Item 1.4 reads the wrangler flags and
          // this class together, so they must not disagree.
          workersDev: !hasAuth,
          previewUrls: !hasAuth,
        },
        // `auth` defaults the exposure to authenticated (generate.ts), and
        // authenticated maps to the contract's `authenticated-public`.
        access: { exposureClass: hasAuth ? 'authenticated-public' : 'public' },
        bindings: { d1: hasDatabase ? [{ binding: 'DB' }] : [], kv: [], queues: [], cron: [] },
      })
      // Live Cloudflare facts stay ABSENT rather than fabricated -- the same
      // rule wrangler.jsonc's missing `account_id` follows. Onboarding adds
      // these, and the deployment check reports NOT ADOPTED (exit 0) until it
      // does.
      expect(declared.deployment, label).toBeUndefined()
      expect(declared.domains, label).toBeUndefined()
      expect((declared.product as Record<string, unknown>).repository, label).toBeUndefined()

      // docs/e2e-testing.md + apps/web/tests/e2e/visual-audit.spec.ts: the
      // shared narduk-testkit UI-quality toolkit, scoped to the one route
      // every scaffold actually has (generator-parity audit narduk-libs#D2 --
      // the reference app's own doc/spec hardcode ~10 product routes this
      // generator cannot know in advance).
      const e2eDoc = byPath.get('docs/e2e-testing.md')
      expect(e2eDoc, label).toBeDefined()
      expect(e2eDoc, label).toContain('## Visual site QA')
      // The quarantine convention travels with the policy: a scaffolded app
      // that ships failOnFlakyTests without telling anyone how to quarantine a
      // flake teaches the retry-hides-it habit the policy exists to end.
      expect(e2eDoc, label).toContain('## Flake policy')
      expect(e2eDoc, label).toContain('### Quarantine convention')
      expect(e2eDoc, label).toContain('test.fixme(')
      expect(e2eDoc, label).toContain('@narduk-enterprises/narduk-testkit/playwright/ui-quality')
      expect(e2eDoc, label).not.toContain('.template-reference')
      expect(e2eDoc, label).not.toContain('run-web-e2e.mjs')
      expect(e2eDoc, label).toContain('E2E_PREBUILT_ARTIFACT=1')
      expect(e2eDoc, label).toContain('narduk-app e2e-serve')
      expect(e2eDoc, label).toContain('kj::getCaughtExceptionAsKj()')
      const visualAudit = byPath.get('apps/web/tests/e2e/visual-audit.spec.ts')
      expect(visualAudit, label).toBeDefined()
      expect(visualAudit, label).toContain(
        "} from '@narduk-enterprises/narduk-testkit/playwright/ui-quality'",
      )
      // narduk-core's build-info plugin logs this banner via console.warn on
      // every page load (universal, not app-specific), so every scaffold's
      // consoleTracker must ignore it the same way the reference app does --
      // matches narduk-libs PR #347 CI: consoleTracker.expectClean() failed
      // on every generated app without this, live-verified.
      expect(visualAudit, label).toContain('createConsoleTracker(page, [/^\\[build\\]/])')
      expect(visualAudit, label).toContain('await consoleTracker.expectClean()')
      expect(visualAudit, label).toContain("{ name: 'home', path: '/' }")

      // apps/web/scripts/validate-manifests.mjs: manifests:validate's
      // implementation, no-ops gracefully pre-onboarding.
      const validateScript = byPath.get('apps/web/scripts/validate-manifests.mjs')
      expect(validateScript, label).toBeDefined()
      expect(validateScript, label).toContain("error.code === 'ENOENT'")
      expect(validateScript, label).toContain('process.exit(0)')

      // apps/web/tests/e2e/fixtures.ts + global.setup.ts: the Playwright
      // "setup project" readiness gate, asserting narduk-core's exact health
      // contract values (report.ts) for this app's own database backend.
      const fixtures = byPath.get('apps/web/tests/e2e/fixtures.ts')
      expect(fixtures, label).toBeDefined()
      expect(fixtures, label).toContain("} from '@narduk-enterprises/narduk-testkit/e2e/fixtures'")
      const globalSetup = byPath.get('apps/web/tests/e2e/global.setup.ts')
      expect(globalSetup, label).toBeDefined()
      expect(globalSetup, label).toContain("import { expect, test } from './fixtures'")
      if (hasDatabase && hasAuth) {
        // A freshly generated auth+database app has never run
        // db:migrate:local/:remote, so narduk-core's (required: false)
        // auth-tables probe genuinely degrades the health response without
        // failing the request -- asserting a hard 'ok' here would fail
        // every such app's own readiness gate before its first migration
        // (narduk-libs PR #347 CI: schema_error/degraded on a fresh
        // packed-consumer-smoke run, live-verified).
        expect(globalSetup, label).toContain(
          'data: { status: expect.stringMatching(/^(ok|degraded)$/u) },',
        )
        expect(globalSetup, label).not.toContain("database: 'ok'")
      } else {
        expect(globalSetup, label).toContain(
          "data: { status: 'ok', database: " + (hasDatabase ? "'ok'" : "'not_applicable'") + ' },',
        )
      }

      // apps/web/wrangler.jsonc: $schema + observability additions.
      const wrangler = byPath.get('apps/web/wrangler.jsonc')
      expect(wrangler, label).toBeDefined()
      expect(wrangler, label).toContain(
        '"$schema": "https://unpkg.com/wrangler@latest/config-schema.json",',
      )
      expect(wrangler, label).toContain('"observability": { "enabled": true },')

      // Root package.json: build:ci / foundation:check / manifests:validate
      // scripts and the root narduk-app-tools devDependency (pnpm only
      // symlinks a package's own deps' bins into its own node_modules/.bin,
      // so narduk-app needs to be a root dep to resolve at root).
      const rootManifest = JSON.parse(byPath.get('package.json')!) as {
        scripts: Record<string, string>
        devDependencies: Record<string, string>
      }
      expect(rootManifest.scripts['build:ci'], label).toBe(
        'NUXT_OG_IMAGE_SECRET=narduk-test-only-og-image-secret-000000 NUXT_SESSION_PASSWORD=narduk-test-only-session-password-000000 NARDUK_CLOUDFLARE_BUILD=1 NITRO_PRESET=cloudflare_module pnpm run build',
      )
      expect(rootManifest.scripts['foundation:check'], label).toBe(
        'mkdir -p foundation-check && narduk-app foundation:check --checkout . --json foundation-check/foundation-check.json',
      )
      expect(rootManifest.scripts['manifests:validate'], label).toBe(
        'pnpm --filter web run manifests:validate',
      )
      expect(rootManifest.devDependencies['@narduk-enterprises/narduk-app-tools'], label).toBe(
        PACKAGE_VERSIONS['@narduk-enterprises/narduk-app-tools'],
      )

      // apps/web/package.json: manifests:validate script + the
      // nitro-cloudflare-dev exact pin (matches Buoys' own lockfile-resolved
      // version, live-verified 2026-09-16).
      const webManifest = JSON.parse(byPath.get('apps/web/package.json')!) as {
        scripts: Record<string, string>
        devDependencies: Record<string, string>
      }
      expect(webManifest.scripts['manifests:validate'], label).toBe(
        'node scripts/validate-manifests.mjs',
      )
      expect(webManifest.devDependencies['nitro-cloudflare-dev'], label).toBe(
        PACKAGE_VERSIONS['nitro-cloudflare-dev'],
      )
      // `--checkout ..` because the item reads Config/cloudflare-app.json and
      // the wrangler config from the repository root, while pnpm runs this
      // script with the cwd at apps/web.
      expect(webManifest.scripts['foundation:deployment'], label).toBe(
        'narduk-app foundation:check:deployment --checkout ..',
      )
    }
  })

  it('validate-manifests.mjs runs, no-ops pre-onboarding, and detects a real binding mismatch', async () => {
    const files = buildGeneratedFiles({
      appName: 'validate-manifests-fixture',
      capabilities: [],
      databaseBackend: 'none',
      noGit: true,
      targetDir: '/tmp/validate-manifests-fixture',
    })
    const script = files.find((file) => file.path === 'apps/web/scripts/validate-manifests.mjs')!
    const wrangler = files.find((file) => file.path === 'apps/web/wrangler.jsonc')!
    const root = await makeTempDirectory()
    const webDir = join(root, 'apps', 'web')
    await mkdir(join(webDir, 'scripts'), { recursive: true })
    await writeFile(join(webDir, 'scripts', 'validate-manifests.mjs'), script.contents)
    await writeFile(join(webDir, 'wrangler.jsonc'), wrangler.contents)
    const run = () =>
      spawnSync(process.execPath, ['scripts/validate-manifests.mjs'], {
        cwd: webDir,
        encoding: 'utf8',
      })

    // Pre-onboarding: ../../Config/cloudflare-app.json does not exist yet.
    // The generator's script must no-op with exit 0, not throw.
    const beforeOnboarding = run()
    expect(beforeOnboarding.status, beforeOnboarding.stderr).toBe(0)
    expect(beforeOnboarding.stdout).toContain('does not exist yet')

    // Onboarding creates Config/cloudflare-app.json with bindings that agree
    // with wrangler.jsonc's zero-binding shape (no database, no uploads).
    await mkdir(join(root, 'Config'), { recursive: true })
    await writeFile(
      join(root, 'Config', 'cloudflare-app.json'),
      JSON.stringify({ bindings: { cron: [], d1: [], kv: [], queues: [], r2: [] } }),
    )
    const agreeing = run()
    expect(agreeing.status, agreeing.stderr).toBe(0)
    expect(agreeing.stdout).toContain('agree')

    // A real disagreement (a manifest claiming a D1 binding this app's
    // wrangler.jsonc does not declare) must fail, not silently pass.
    await writeFile(
      join(root, 'Config', 'cloudflare-app.json'),
      JSON.stringify({
        bindings: { cron: [], d1: [{ binding: 'DB' }], kv: [], queues: [], r2: [] },
      }),
    )
    const disagreeing = run()
    expect(disagreeing.status).not.toBe(0)
    expect(disagreeing.stderr).toContain('wrangler bindings disagree')
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
    expect(rootPackage.scripts['cf:build']).toBe(
      'node scripts/gh-packages-run.mjs -- pnpm install --frozen-lockfile && pnpm --filter web run cf:build',
    )
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
    // narduk-libs#321: the generated dev script starts Nuxt directly. The old
    // wrapper meant an implicit `doppler run` against the retired app-secret
    // store for every generated app.
    expect(webPackage.scripts.dev).toBe('nuxt dev --host 127.0.0.1')
    expect(webPackage.scripts['dev:test']).toBe(
      'narduk-app og:generate --if-missing && TEST=1 nuxt dev --host 127.0.0.1',
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
    // '@nuxt/ui' is deliberately absent from the modules array: narduk-core's
    // own setup already calls installModule('@nuxt/ui') internally, and a
    // second explicit registration here is redundant (matches the reference
    // app, generator-parity audit narduk-libs#D2).
    expect(generatedNuxtConfig).not.toContain("'@nuxt/ui'")
    // '@nuxt/icon' IS explicit, though, and this is NOT redundant -- live
    // regression coverage for a real build failure this audit found.
    // narduk-core's installModule('@nuxt/ui') itself nests an
    // installModule('@nuxt/icon') call, but that nested install does not
    // finish registering the Nuxt Icon client-bundle virtual file
    // (#build/nuxt-icon-client-bundle) before the build step that consumes
    // it, which fails the whole build with UNLOADABLE_DEPENDENCY when
    // '@nuxt/icon' is only reachable that way. Listing it explicitly here
    // (matching the reference app's own modules array and devDependency
    // exactly) fixes it -- verified live against a fresh `pnpm run build`.
    expect(generatedNuxtConfig).toContain("'@nuxt/icon'")
    expect(generatedNuxtConfig.indexOf("'@narduk-enterprises/narduk-core'")).toBeLessThan(
      generatedNuxtConfig.indexOf("'@nuxt/icon'"),
    )
    expect(generatedNuxtConfig.indexOf("'@nuxt/icon'")).toBeLessThan(
      generatedNuxtConfig.indexOf("'@narduk-enterprises/narduk-shell'"),
    )
    const generatedCi = await readFile(join(targetDir, '.github/workflows/ci.yml'), 'utf8')
    expect(generatedCi).toContain('nuxt-cloudflare.yml@6f56678ad7562234e465284e48f27008e0f32db7')
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
    // Flake policy: one retry with a trace on it, and on the default branch a
    // test that only passes on the retry FAILS rather than reporting green.
    // The event branch must be fail-CLOSED -- an unset GITHUB_EVENT_NAME takes
    // the strict path -- so assert the negated pull-request form, not a
    // positive push check that an unset variable would fall out of.
    expect(generatedPlaywrightConfig).toContain('retries: isCI ? 1 : 0,')
    expect(generatedPlaywrightConfig).not.toContain('retries: process.env.CI ? 2 : 0,')
    expect(generatedPlaywrightConfig).toContain('failOnFlakyTests: strictFlakePolicy,')
    expect(generatedPlaywrightConfig).toContain(
      "isCI && !(process.env.GITHUB_EVENT_NAME ?? '').startsWith('pull_request')",
    )
    // narduk-libs#62 and #417: the port must come from the shared resolver --
    // declared in the primary checkout and CI, derived from the checkout path
    // in a linked worktree, PLAYWRIGHT_PORT over both -- and flow into baseURL,
    // the webServer url, AND the webServer command's PORT env. Otherwise two
    // concurrent worktrees attach to the same fixed port and one test run
    // silently exercises the other lane's app.
    expect(generatedPlaywrightConfig).toContain(
      "} from '@narduk-enterprises/narduk-testkit/playwright/dev-port'",
    )
    expect(generatedPlaywrightConfig).toContain('declaredPort: 4377,')
    // Playwright transpiles this config to CJS (the generated root package.json
    // is not `"type": "module"` and nothing injects tsx), where `import.meta`
    // is a SYNTAX error -- caught live by packed-consumer-smoke.
    expect(generatedPlaywrightConfig).toContain('rootDir: process.cwd(),')
    expect(
      generatedPlaywrightConfig
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && line.includes('import.meta')),
    ).toEqual([])
    expect(generatedPlaywrightConfig).toContain('const port = devPort.port')
    // Reuse is a decision the resolver makes, never the old `!isCI`: a derived
    // port must not adopt a server this checkout did not start.
    expect(generatedPlaywrightConfig).toContain(
      'const reuseExistingServer = shouldReuseExistingServer({ resolution: devPort })',
    )
    expect(generatedPlaywrightConfig).toContain(
      'assertLocalDevPortAvailable({ resolution: devPort })',
    )
    expect(generatedPlaywrightConfig).toContain('reuseExistingServer,')
    expect(generatedPlaywrightConfig).not.toContain('reuseExistingServer: !isCI,')
    expect(generatedPlaywrightConfig).toContain('baseURL: `http://127.0.0.1:${port}`')
    // /api/health, not just '/': Playwright's own readiness probe only checks
    // for an HTTP 200-403 response, which a page that has not finished SSR
    // rendering can still satisfy. The 'setup' project's global.setup.ts
    // verifies the health body and warms a real page render.
    expect(generatedPlaywrightConfig).toContain('url: `http://127.0.0.1:${port}/api/health`')
    expect(generatedPlaywrightConfig).toContain("name: 'setup'")
    expect(generatedPlaywrightConfig).toContain("dependencies: ['setup']")
    expect(generatedPlaywrightConfig).toContain('`PORT=${port} NUXT_SESSION_PASSWORD=')
    expect(generatedPlaywrightConfig).toContain("process.env.E2E_PREBUILT_ARTIFACT === '1'")
    expect(generatedPlaywrightConfig).toContain('narduk-app e2e-serve ${port}')
    expect(generatedPlaywrightConfig).toContain('pnpm --filter web run dev:test')
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

  // narduk-libs#349: X reads `og:*` when no `twitter:*` tag is present, and Unhead 3
  // reports every `twitter:*` meta name -- `twitter:card` included -- as deprecated,
  // which turns the shared browser-console contract red on every route of a scaffold.
  it('scaffolds an Open Graph head with declared dimensions and no twitter:* meta', () => {
    for (const { capabilities, label } of capabilitySets) {
      const nuxtConfig = generate(capabilities).get('apps/web/nuxt.config.ts') ?? ''

      expect(nuxtConfig.includes('twitter:'), label).toBe(false)
      if (capabilities.includes('seo')) continue
      // A no-seo scaffold hand-writes the head that narduk-seo would otherwise own.
      for (const tag of [
        "{ property: 'og:title', content: appName }",
        "{ property: 'og:image:alt', content: appName + ' \u2014 ' + appDescription }",
        "{ property: 'og:image:width', content: '1200' }",
        "{ property: 'og:image:height', content: '630' }",
      ]) {
        expect(nuxtConfig, label).toContain(tag)
      }
    }
  })

  // narduk-libs#321: a generated app must not acquire an implicit dependency on
  // a secret manager just by running `pnpm run dev`. The retired wrapper shape
  // `narduk-app dev --project … --config …` meant `doppler run`, so no
  // generated file may carry it, and no generated file may name Doppler at all.
  it('starts development without any secret-store dependency, for every capability set', () => {
    for (const { capabilities, label } of capabilitySets) {
      const files = generate(capabilities)
      const webPackage = JSON.parse(files.get('apps/web/package.json') ?? '{}') as {
        scripts: Record<string, string>
      }
      const rootPackage = JSON.parse(files.get('package.json') ?? '{}') as {
        scripts: Record<string, string>
      }
      const generatedText = [...files.values()].join('\n')

      expect(webPackage.scripts.dev, label).toBe('nuxt dev --host 127.0.0.1')
      expect(rootPackage.scripts.dev, label).toBe('pnpm --filter web run dev')
      // No generated script invokes the wrapper at all, and nothing anywhere in
      // the scaffold carries the retired selector shape or names Doppler.
      for (const [name, script] of Object.entries({
        ...rootPackage.scripts,
        ...webPackage.scripts,
      })) {
        expect(`${name}: ${script}`, label).not.toMatch(/narduk-app dev/u)
      }
      expect(generatedText, label).not.toMatch(/narduk-app dev --project/u)
      expect(generatedText, label).not.toMatch(/doppler/iu)
      // The route an app adopts when it does need credentials locally is named
      // in the generated README, so the migration target is discoverable.
      expect(files.get('README.md'), label).toContain('--credentials nvault')
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

  it('puts test-only Nuxt build env in public CI jobs and on private build:ci', () => {
    const publicFiles = generate(['seo'])
    // generate() defaults to private; rebuild public explicitly.
    const publicCi = asFileMap(
      buildGeneratedFiles({
        appName: 'surface-check',
        capabilities: ['seo'],
        noGit: true,
        targetDir: '/tmp/surface-check',
        visibility: 'public',
      }),
    ).get('.github/workflows/ci.yml')!
    expect(publicCi).toContain('NUXT_OG_IMAGE_SECRET: narduk-test-only-og-image-secret-000000')
    expect(publicCi).toContain('NUXT_SESSION_PASSWORD: narduk-test-only-session-password-000000')
    expect(publicCi).toContain('- run: pnpm run quality:static')
    expect(publicCi).not.toContain('secrets.NUXT_OG_IMAGE_SECRET')

    const privateRoot = JSON.parse(publicFiles.get('package.json') ?? '{}') as {
      scripts: Record<string, string>
    }
    expect(privateRoot.scripts['build:ci']).toContain(
      'NUXT_OG_IMAGE_SECRET=narduk-test-only-og-image-secret-000000',
    )
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
      expect(ci, label).toContain('nuxt-cloudflare.yml@6f56678ad7562234e465284e48f27008e0f32db7')
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

  // Matches the reference app's live shape (company-hq D-TOOLCHAIN-1,
  // generator-parity audit narduk-libs#D2), not the older canonical
  // template: `scope` is functionally required, not decorative -- without
  // it Dependabot's npm_and_yarn update aborts outright the moment the repo
  // carries any @narduk-enterprises/* dependency (coding-standards#9). One
  // combined `dependencies` group still keeps a main-branch merge from
  // triggering several simultaneous update PRs (foundation:check item 5.2's
  // "grouping .github/dependabot.yml" acceptance shape, narduk-libs#233).
  it('emits a .github/dependabot.yml with the required registry scope and a github-actions ecosystem block', () => {
    for (const { capabilities, label } of capabilitySets) {
      const files = generate(capabilities)
      const dependabot = files.get('.github/dependabot.yml') ?? ''

      expect(dependabot, label).toContain("package-ecosystem: 'npm'")
      expect(dependabot, label).toContain("package-ecosystem: 'github-actions'")
      expect(dependabot, label).toContain("scope: '@narduk-enterprises'")
      expect(dependabot, label).toContain('dependencies:')
      expect(dependabot, label).toContain("- '@narduk-enterprises/*'")
      // Reuses the same registry URL as the committed .npmrc and the same
      // org Actions secret name already used for install auth -- no new
      // registry or credential name invented for Dependabot.
      expect(dependabot, label).toContain('url: https://npm.pkg.github.com')
      expect(dependabot, label).toContain('${{secrets.NARDUK_PLATFORM_GH_PACKAGES_READ}}')
      expect(() => YAML.parse(dependabot), label).not.toThrow()
      const parsed = YAML.parse(dependabot) as {
        version: number
        registries: Record<string, { type: string; url: string; scope: string }>
        updates: Array<{
          'package-ecosystem': string
          directory?: string
          registries?: string[]
          groups: Record<string, { patterns: string[] }>
        }>
      }
      expect(parsed.version, label).toBe(2)
      expect(parsed.registries['narduk-github-packages'].scope, label).toBe('@narduk-enterprises')
      expect(parsed.updates, label).toHaveLength(2)
      const npmUpdate = parsed.updates.find((update) => update['package-ecosystem'] === 'npm')
      expect(npmUpdate?.directory, label).toBe('/')
      expect(npmUpdate?.registries, label).toEqual(['narduk-github-packages'])
      expect(npmUpdate?.groups.dependencies.patterns, label).toEqual(['*', '@narduk-enterprises/*'])
      const actionsUpdate = parsed.updates.find(
        (update) => update['package-ecosystem'] === 'github-actions',
      )
      expect(actionsUpdate?.directory, label).toBe('/')
      expect(files.has('renovate.json'), label).toBe(false)
    }
  })

  // components-library-plan.md #2 item 4 (narduk-libs#251): every new app
  // starts on the Nuxt UI element discipline and Tailwind v4 token tier
  // (`design-system`) and the legacy-API guardrails (`nuxt-ui`), the same way
  // it already starts on `core`, `correctness`, `complexity` and `formatting`.
  it('adds the design-system and nuxt-ui capability packs to both generated eslint configs', () => {
    for (const { capabilities, label } of capabilitySets) {
      const files = generate(capabilities)
      const appConfig = files.get('apps/web/eslint.config.mjs') ?? ''
      const rootConfig = files.get('eslint.config.mjs') ?? ''

      expect(appConfig, label).toContain("capabilityPacks: ['core', 'correctness', 'complexity'")
      expect(appConfig, label).toContain("'design-system', 'nuxt-ui']")
      expect(rootConfig, label).toContain("'core',")
      expect(rootConfig, label).toContain("'design-system',")
      expect(rootConfig, label).toContain("'nuxt-ui',")
    }
  })

  // Logan 2026-09-18: warnings are held to a checked-in budget instead of
  // `--max-warnings 0`. The web app lints through narduk-lint, and a new app
  // starts with an empty budget, so any warning it later accepts is recorded
  // by a local `pnpm lint` and reviewed in the diff.
  it('lints the web app through narduk-lint with an empty warning budget', () => {
    for (const { capabilities, label } of capabilitySets) {
      const files = generate(capabilities)
      const webManifest = JSON.parse(files.get('apps/web/package.json') ?? '{}') as {
        scripts: Record<string, string>
      }

      expect(webManifest.scripts.lint, label).toBe('nuxt prepare && narduk-lint')
      expect(webManifest.scripts.lint, label).not.toContain('--max-warnings')
      expect(files.get('apps/web/lint-budget.json'), label).toBe('{\n  "rules": {}\n}\n')
      expect(JSON.parse(files.get('apps/web/lint-budget.json') ?? ''), label).toEqual({
        rules: {},
      })
    }
  })

  // components-library-plan.md #2 item 4: narduk-shell ships to every
  // generated app by default -- not behind a capability flag, the same way
  // narduk-core always ships -- with an exact pin.
  it('installs narduk-shell as a default module and dependency for every capability set', () => {
    for (const { capabilities, label } of capabilitySets) {
      const files = generate(capabilities)
      const nuxtConfig = files.get('apps/web/nuxt.config.ts') ?? ''
      const webManifest = JSON.parse(files.get('apps/web/package.json') ?? '{}') as {
        dependencies: Record<string, string>
      }

      expect(nuxtConfig, label).toContain("'@narduk-enterprises/narduk-shell'")
      expect(webManifest.dependencies['@narduk-enterprises/narduk-shell'], label).toBe(
        PACKAGE_VERSIONS['@narduk-enterprises/narduk-shell'],
      )
    }
  })

  // components-library-plan.md #2 item 4: unlike every other capability
  // package, narduk-charts is not a Nuxt module (no `nuxt` peer, no
  // `module.ts`) -- it is a plain Vue component library the app imports from
  // directly, so it must never appear in the Nuxt `modules: [...]` array, and
  // it needs a knip ignore because nothing in the scaffold imports it yet.
  it('pins narduk-charts for the charts capability without registering it as a Nuxt module', () => {
    const withCharts = generate(['charts'])
    const webManifest = JSON.parse(withCharts.get('apps/web/package.json') ?? '{}') as {
      dependencies: Record<string, string>
    }
    const nuxtConfig = withCharts.get('apps/web/nuxt.config.ts') ?? ''
    const knipConfig = JSON.parse(withCharts.get('knip.json') ?? '{}') as {
      ignoreDependencies: string[]
    }

    expect(webManifest.dependencies['@narduk-enterprises/narduk-charts']).toBe(
      PACKAGE_VERSIONS['@narduk-enterprises/narduk-charts'],
    )
    expect(nuxtConfig).not.toContain("'@narduk-enterprises/narduk-charts'")
    // narduk-shell still ships regardless of the charts capability.
    expect(nuxtConfig).toContain("'@narduk-enterprises/narduk-shell'")
    expect(knipConfig.ignoreDependencies).toContain('@narduk-enterprises/narduk-charts')

    const withoutCharts = generate([])
    const webManifestWithout = JSON.parse(withoutCharts.get('apps/web/package.json') ?? '{}') as {
      dependencies: Record<string, string>
    }
    const knipConfigWithout = JSON.parse(withoutCharts.get('knip.json') ?? '{}') as {
      ignoreDependencies: string[]
    }
    expect(webManifestWithout.dependencies['@narduk-enterprises/narduk-charts']).toBeUndefined()
    expect(knipConfigWithout.ignoreDependencies).not.toContain('@narduk-enterprises/narduk-charts')
  })
})

describe('database-free scaffold', () => {
  const DATABASE_PATHS = [
    'apps/web/drizzle.config.ts',
    'apps/web/drizzle/README.md',
    'apps/web/drizzle/0000_app_records.sql',
    'apps/web/server/database/schema.ts',
    'apps/web/server/utils/database.ts',
    'apps/web/migrations.sources.json',
  ]

  function scaffold(databaseBackend: 'd1' | 'none' | undefined, capabilities: string[] = []) {
    return asFileMap(
      buildGeneratedFiles({
        appName: 'publication-viewer',
        capabilities,
        databaseBackend,
        noGit: true,
        targetDir: '/tmp/publication-viewer',
      }),
    )
  }

  it('keeps every database artifact for the default and explicit d1 scaffolds', () => {
    for (const backend of [undefined, 'd1'] as const) {
      const files = scaffold(backend)
      for (const path of DATABASE_PATHS) {
        expect([...files.keys()], String(backend)).toContain(path)
      }
      expect(files.get('apps/web/nuxt.config.ts')).toContain("'#narduk-db'")
      expect(files.get('apps/web/wrangler.jsonc')).toContain('"d1_databases"')
      expect(files.get('apps/web/nuxt.config.ts')).not.toContain('nardukCore')
    }
  })

  it('omits every database artifact when the app declares no database', () => {
    const files = scaffold('none')
    for (const path of DATABASE_PATHS) {
      expect([...files.keys()]).not.toContain(path)
    }
    expect([...files.keys()].some((path) => path.includes('drizzle'))).toBe(false)
  })

  it("declares databaseBackend 'none' to narduk-core instead of aliasing #narduk-db", () => {
    const config = scaffold('none').get('apps/web/nuxt.config.ts') ?? ''

    expect(config).toContain('nardukCore: {')
    expect(config).toContain("databaseBackend: 'none',")
    expect(config).not.toContain('#narduk-db')
    // fileURLToPath is no longer database-only: nitro.cloudflareDev.configPath
    // (nitro-cloudflare-dev wiring) needs it unconditionally now, to resolve
    // wrangler.jsonc's path regardless of databaseBackend.
    expect(config).toContain("import { fileURLToPath } from 'node:url'")
    expect(config).toContain("configPath: fileURLToPath(new URL('./wrangler.jsonc'")
  })

  it('drops the D1 binding from wrangler while keeping other bindings', () => {
    expect(scaffold('none').get('apps/web/wrangler.jsonc')).not.toContain('d1_databases')
    expect(scaffold('none').get('apps/web/wrangler.jsonc')).not.toContain('migrations_dir')
    expect(scaffold('none', ['uploads']).get('apps/web/wrangler.jsonc')).toContain('r2_buckets')
  })

  it('drops the migrate scripts and the drizzle pins from both manifests', () => {
    const files = scaffold('none')
    const web = JSON.parse(files.get('apps/web/package.json') ?? '{}')
    const root = JSON.parse(files.get('package.json') ?? '{}')

    expect(web.scripts).not.toHaveProperty('db:migrate:local')
    expect(web.scripts).not.toHaveProperty('db:migrate:remote')
    expect(root.scripts).not.toHaveProperty('db:migrate:local')
    expect(root.scripts).not.toHaveProperty('db:migrate:remote')
    expect(web.scripts['cf:deploy']).toBe('narduk-app deploy deploy')
    expect(collectVersionedDependencies(web)).not.toHaveProperty('drizzle-orm')
    expect(collectVersionedDependencies(web)).not.toHaveProperty('drizzle-kit')

    const d1Web = JSON.parse(scaffold('d1').get('apps/web/package.json') ?? '{}')
    expect(d1Web.scripts['db:migrate:remote']).toContain('narduk-app db migrate')
    expect(d1Web.scripts['cf:deploy']).toContain('narduk-app db migrate')
    expect(collectVersionedDependencies(d1Web)).toHaveProperty('drizzle-orm')
  })

  it('emits a knip config that still parses without the #narduk-db path mapping', () => {
    const knip = scaffold('none').get('knip.json') ?? ''

    expect(() => JSON.parse(knip)).not.toThrow()
    expect(knip).not.toContain('#narduk-db')
    expect(JSON.parse(knip).workspaces['apps/web']).not.toHaveProperty('paths')
    expect(
      JSON.parse(scaffold('d1').get('knip.json') ?? '{}').workspaces['apps/web'].paths,
    ).toEqual({ '#narduk-db': ['server/database/schema.ts'] })
  })

  it('points app guidance at registerHealthCheck rather than at the schema', () => {
    const guidance = scaffold('none').get('apps/web/AGENTS.md') ?? ''

    expect(guidance).toContain('registerHealthCheck')
    expect(guidance).toContain('not_applicable')
    expect(guidance).not.toContain('#narduk-db')
  })

  it('rejects the auth capability without a database', () => {
    expect(() => scaffold('none', ['auth'])).toThrow(/cannot be combined with databaseBackend/u)
    expect(() => scaffold('none', ['auth'])).toThrow(/Drop the auth capability/u)
  })

  it('rejects a backend the generator cannot scaffold', () => {
    expect(() =>
      buildGeneratedFiles({
        appName: 'hyperdrive-app',
        databaseBackend: 'postgres' as 'd1',
        noGit: true,
        targetDir: '/tmp/hyperdrive-app',
      }),
    ).toThrow(/databaseBackend must be one of 'd1', 'none'/u)
  })

  it('still emits Prettier-canonical files and parses every config surface', async () => {
    const files = buildGeneratedFiles({
      appName: 'no-db-format',
      capabilities: ['seo', 'analytics', 'uploads', 'ai', 'mapkit'],
      databaseBackend: 'none',
      noGit: true,
      targetDir: '/tmp/no-db-format',
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

  it('records the resolved backend in the JSON report', async () => {
    const targetDir = await makeTempDirectory()
    const report = await createNardukApp({
      appName: 'reported-no-db',
      databaseBackend: 'none',
      noGit: true,
      targetDir,
    })

    expect(report.databaseBackend).toBe('none')
    expect(report.files).not.toContain('apps/web/server/database/schema.ts')
    expect(report.packageVersions).not.toHaveProperty('drizzle-orm')
  })
})

describe('CLI argument parsing', () => {
  it('keeps app exposure independent from repository visibility', async () => {
    const { parseCliArguments } = await import('../src/cli.js')
    const parsed = parseCliArguments([
      'public-viewer',
      '--visibility',
      'private',
      '--exposure',
      'public',
    ])
    const files = asFileMap(buildGeneratedFiles(parsed.options))
    const wrangler = ts.parseConfigFileTextToJson(
      'wrangler.jsonc',
      files.get('apps/web/wrangler.jsonc') ?? '',
    ).config
    expect(wrangler.workers_dev).toBe(true)
    expect(wrangler.preview_urls).toBe(true)
    expect(parsed.options.visibility).toBe('private')
  })

  it.each([
    { capabilities: ['auth'], exposure: undefined },
    { capabilities: [], exposure: 'authenticated' as const },
  ])('closes direct hostnames for authenticated apps: %j', (options) => {
    const files = asFileMap(
      buildGeneratedFiles({
        appName: 'private-tool',
        targetDir: '/tmp/private-tool',
        ...options,
      }),
    )
    const wrangler = ts.parseConfigFileTextToJson(
      'wrangler.jsonc',
      files.get('apps/web/wrangler.jsonc') ?? '',
    ).config
    expect(wrangler.workers_dev).toBe(false)
    expect(wrangler.preview_urls).toBe(false)
  })

  // S9 -- the runbook tells every new app to paste this block and then run the
  // check. Until now the block was ~24 hand-typed string literals and the only
  // assertions on it were substrings, so adding a required key to the schema
  // would have shipped a generator whose paste-this block fails the very check
  // it tells you to run -- discovered by the first app to try it, not by CI.
  describe('the deployment block the runbook tells you to paste', () => {
    function pastedBlock(appName: string): unknown {
      const files = asFileMap(buildGeneratedFiles({ appName, targetDir: `/tmp/${appName}` }))
      const runbook = files.get('docs/workers-builds.md') ?? ''
      const fence = /```jsonc\n("deployment": [\s\S]*?)\n```/u.exec(runbook)
      expect(fence, 'the runbook carries a fenced jsonc deployment block').not.toBeNull()
      // The fence holds a fragment ("deployment": {...}) meant to be pasted
      // INTO an object, so it is parsed as one.
      return JSON.parse(`{${fence?.[1] ?? ''}}`)
    }

    it('is valid JSON, not prose that happens to look like it', () => {
      const parsed = pastedBlock('paste-check') as Record<string, unknown>
      expect(isRecord(parsed.deployment)).toBe(true)
    })

    it('is exactly the block narduk-app-tools hands a new app', async () => {
      // narduk-app-tools' own suite pins this fixture to
      // `defaultDeploymentBlock()` AND to `readDeploymentBlock` accepting it,
      // so equality here means the pasted block satisfies the very check the
      // runbook tells the new app to run.
      const canonical: unknown = JSON.parse(await readFile(CANONICAL_DEPLOYMENT_BLOCK, 'utf8'))
      const parsed = pastedBlock('paste-check') as Record<string, unknown>
      expect(parsed.deployment).toEqual(canonical)
    })

    it('names this app in the promotion credential', () => {
      const parsed = pastedBlock('other-app') as {
        deployment: { promotion: { credential: string } }
      }
      expect(parsed.deployment.promotion.credential).toBe(
        'cloudflare/prd/narduk-enterprises-other-app-promote',
      )
    })
  })

  it('rejects a public-preview override for an auth app', () => {
    expect(() =>
      buildGeneratedFiles({
        appName: 'private-tool',
        targetDir: '/tmp/private-tool',
        capabilities: ['auth'],
        exposure: 'public',
      }),
    ).toThrow('Auth apps require authenticated exposure')
  })

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

  it.each([
    { argv: ['--no-database'], expected: 'none' },
    { argv: ['--database', 'none'], expected: 'none' },
    { argv: ['--database=none'], expected: 'none' },
    { argv: ['--database-backend=d1'], expected: 'd1' },
    { argv: [], expected: undefined },
  ])('parses $argv into databaseBackend $expected', async ({ argv, expected }) => {
    const parsed = (await import('../src/cli.js')).parseCliArguments(
      ['db-flag-app', ...argv],
      '/workspace',
    )
    expect(parsed.options.databaseBackend).toBe(expected)
  })

  it('rejects a database backend the generator cannot scaffold', async () => {
    const { parseCliArguments } = await import('../src/cli.js')
    expect(() => parseCliArguments(['pg-app', '--database', 'postgres'], '/workspace')).toThrow(
      /--database must be d1 or none/u,
    )
  })

  it('documents the database flags in help output', async () => {
    const chunks: string[] = []
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk))
        callback()
      },
    })
    await runCli({ argv: ['--help'], stdout: output })
    expect(chunks.join('')).toContain('--no-database')
    expect(chunks.join('')).toContain('--database <value>')
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

/**
 * narduk-libs#617: a fresh scaffold could not pass its own gate, and its
 * first CI run was red by construction. Each case below pins one of the
 * defects that made that true, in the direction that proves the fix rather
 * than the direction that happened to be green on a short fixture.
 */
describe('a fresh scaffold passes its own gate', () => {
  // The exact description from the narduk-libs#617 reproduction. Long free
  // text is what crossed printWidth; a short one masks the whole class.
  const LONG_DESCRIPTION =
    'Youth running club site for Austin Rising Runners: season schedule, meets, results, ' +
    'roster and club information for member families.'
  const LONG_DISPLAY_NAME = 'Austin Rising Runners Youth Track and Cross Country Club'

  const PRETTIER_OPTIONS = {
    endOfLine: 'lf',
    printWidth: 100,
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
  } as const

  it('stays Prettier-canonical when the caller free text is long', async () => {
    const files = buildGeneratedFiles({
      appName: 'long-text',
      capabilities: ['auth', 'seo', 'analytics', 'uploads'],
      description: LONG_DESCRIPTION,
      displayName: LONG_DISPLAY_NAME,
      siteUrl: 'https://austin-rising-runners-youth-track-and-cross-country.example.nard.uk',
      noGit: true,
      targetDir: '/tmp/long-text',
    })
    const supported = /\.(?:css|json|jsonc|md|mjs|ts|vue|ya?ml)$/u

    for (const file of files.filter((candidate) => supported.test(candidate.path))) {
      expect(
        await prettier.check(file.contents, { ...PRETTIER_OPTIONS, filepath: file.path }),
        file.path,
      ).toBe(true)
    }
  })

  it('breaks a long const after the "=" exactly where Prettier does', () => {
    const files = new Map(
      buildGeneratedFiles({
        appName: 'long-const',
        capabilities: ['seo'],
        description: LONG_DESCRIPTION,
        noGit: true,
        targetDir: '/tmp/long-const',
      }).map((file) => [file.path, file.contents]),
    )
    // Both emitters that interpolate the description, both broken.
    expect(files.get('apps/web/app/pages/index.vue')).toContain(
      `const description =\n  '${LONG_DESCRIPTION}'`,
    )
    expect(files.get('apps/web/nuxt.config.ts')).toContain(
      `const appDescription =\n  '${LONG_DESCRIPTION}'`,
    )
    // A short one still fits on the declaration line, which is also what
    // Prettier produces -- the helper must not break unconditionally.
    const short = new Map(
      buildGeneratedFiles({
        appName: 'short-const',
        capabilities: ['seo'],
        description: 'A short description.',
        noGit: true,
        targetDir: '/tmp/short-const',
      }).map((file) => [file.path, file.contents]),
    )
    expect(short.get('apps/web/nuxt.config.ts')).toContain(
      "const appDescription = 'A short description.'\n",
    )
  })

  it('does not report its own deliberate pins as unused dependencies', () => {
    const files = new Map(
      buildGeneratedFiles({
        appName: 'knip-fixture',
        capabilities: ['auth', 'seo', 'analytics', 'uploads'],
        noGit: true,
        targetDir: '/tmp/knip-fixture',
      }).map((file) => [file.path, file.contents]),
    )
    const knip = JSON.parse(files.get('knip.json') ?? '{}') as { ignoreDependencies: string[] }
    const web = JSON.parse(files.get('apps/web/package.json') ?? '{}') as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    // Both are really in the generated manifest -- an ignore entry for a
    // dependency the app does not declare would be dead config, and knip
    // reports those too.
    expect(web.dependencies['@narduk-enterprises/narduk-logging']).toBeDefined()
    expect(web.devDependencies.eslint).toBeDefined()
    // Neither is reachable by a named import: narduk-logging is wired through
    // runtimeConfig.nardukLogging, eslint through the narduk-lint binary.
    expect(knip.ignoreDependencies).toContain('@narduk-enterprises/narduk-logging')
    expect(knip.ignoreDependencies).toContain('eslint')
  })

  it('never emits narduk-ai runtimeConfig into an app without the ai capability', () => {
    for (const capabilities of [
      ['auth', 'seo', 'analytics', 'uploads'],
      [],
      ['ai'],
    ] as Capability[][]) {
      const config =
        buildGeneratedFiles({
          appName: 'xai-fixture',
          capabilities,
          noGit: true,
          targetDir: '/tmp/xai-fixture',
        }).find((file) => file.path === 'apps/web/nuxt.config.ts')?.contents ?? ''
      // @narduk-enterprises/narduk-ai declares xaiApiKey itself, with a
      // validator, through defu. An app-side `process.env.XAI_API_KEY || ''`
      // both leaked the key into capability sets that never asked for it and
      // WON that merge for the apps that did, replacing the validated value
      // with an empty string.
      expect(config, JSON.stringify(capabilities)).not.toContain('xaiApiKey:')
    }
  })

  it('builds the local gate with the same script CI builds with', () => {
    const root = JSON.parse(
      buildGeneratedFiles({
        appName: 'gate-fixture',
        capabilities: ['seo'],
        noGit: true,
        targetDir: '/tmp/gate-fixture',
      }).find((file) => file.path === 'package.json')?.contents ?? '{}',
    ) as { scripts: Record<string, string> }
    const segments = root.scripts['quality:static'].split(' && ')

    // `build` alone throws in any seo app with an empty NUXT_OG_IMAGE_SECRET,
    // so the documented local gate was red where CI was green.
    expect(segments).toContain('pnpm run build:ci')
    expect(segments).not.toContain('pnpm run build')
    // `build` survives as the real-secret path.
    expect(root.scripts.build).toBe('pnpm --filter web run build')
    expect(root.scripts['build:ci']).toContain('pnpm run build')
  })

  it('warns that a repo missing from the runner groups queues its first run forever', () => {
    const readme = (visibility: 'private' | 'public') =>
      buildGeneratedFiles({
        appName: 'runner-fixture',
        capabilities: ['seo'],
        noGit: true,
        targetDir: '/tmp/runner-fixture',
        visibility,
      }).find((file) => file.path === 'README.md')?.contents ?? ''

    // Self-hosted CI gives no error, no timeout and no log when no runner can
    // pick a job up -- the run just sits in `queued`. The route names in the
    // generated workflow do not grant membership, so this has to be said
    // where the person about to push will read it.
    expect(readme('private')).toContain('sits in `queued` indefinitely')
    expect(readme('private')).toContain('fleet runner groups')
    // Public apps run on GitHub-hosted runners and never hit this.
    expect(readme('public')).not.toContain('fleet runner groups')
  })

  it('declares its own half of Config/cloudflare-app.json, agreeing with wrangler.jsonc', async () => {
    const files = buildGeneratedFiles({
      appName: 'declaration-fixture',
      capabilities: ['auth', 'seo', 'analytics', 'uploads'],
      noGit: true,
      targetDir: '/tmp/declaration-fixture',
    })
    const byPath = new Map(files.map((file) => [file.path, file.contents]))
    const root = await makeTempDirectory()
    const webDir = join(root, 'apps', 'web')
    await mkdir(join(webDir, 'scripts'), { recursive: true })
    await mkdir(join(root, 'Config'), { recursive: true })
    for (const path of [
      'apps/web/scripts/validate-manifests.mjs',
      'apps/web/wrangler.jsonc',
      'Config/cloudflare-app.json',
    ]) {
      await writeFile(join(root, path), byPath.get(path)!)
    }

    // The generated pair must agree on the generator's own output -- this is
    // the check that runs pre-deploy on every build, and before this change
    // it could only ever no-op.
    const result = spawnSync(process.execPath, ['scripts/validate-manifests.mjs'], {
      cwd: webDir,
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('agree')
    expect(result.stdout).not.toContain('does not exist yet')
  })
})
