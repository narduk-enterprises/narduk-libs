import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

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
    expect(first.get('create-narduk-app-report.json')).not.toContain('/one/target')
    expect(first.get('create-narduk-app-report.json')).not.toContain('/two/target')
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
    const report = JSON.parse(files.get('create-narduk-app-report.json') ?? '') as {
      capabilities: string[]
      packageVersions: Record<string, string>
    }
    const dependencies = collectVersionedDependencies(webManifest)

    expect(rootManifest.narduk).toEqual({
      capabilities: ['auth', 'seo', 'analytics', 'uploads', 'ai', 'mapkit'],
      visibility: 'private',
    })
    expect(report.capabilities).toEqual(['auth', 'seo', 'analytics', 'uploads', 'ai', 'mapkit'])
    expect(dependencies['@narduk-enterprises/narduk-core']).toBe(
      PACKAGE_VERSIONS['@narduk-enterprises/narduk-core'],
    )
    expect(dependencies['@narduk-enterprises/narduk-ai']).toBe(
      PACKAGE_VERSIONS['@narduk-enterprises/narduk-ai'],
    )
    expect(dependencies['@loganrenz/narduk-mapkit']).toBe(
      PACKAGE_VERSIONS['@loganrenz/narduk-mapkit'],
    )
    expect(Object.values(dependencies).every((version) => /^\d+\.\d+\.\d+$/u.test(version))).toBe(
      true,
    )
    expect(
      Object.entries(report.packageVersions).every(([, version]) =>
        /^\d+\.\d+\.\d+$/u.test(version),
      ),
    ).toBe(true)
    expect(files.get('apps/web/nuxt.config.ts')).toContain("'@narduk-enterprises/narduk-ai'")
    expect(files.get('apps/web/nuxt.config.ts')).not.toContain('narduk-mapkit')
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
    const report = JSON.parse(chunks.join('')) as { appName: string; capabilities: string[] }
    expect(report.appName).toBe('json-app')
    expect(report.capabilities).toEqual(['auth', 'seo'])
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
    expect(paths).not.toContain('.npmrc')

    const generatedText = files.map((file) => file.contents).join('\n')
    expect(generatedText).not.toContain('postinstall')
    expect(generatedText).not.toContain('git+')
    expect(generatedText).not.toContain('NARDUK_PLATFORM_GH_PACKAGES')
    expect(generatedText).not.toContain('provision.json')

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
      JSON.parse(await readFile(join(targetDir, 'migrations.sources.json'), 'utf8')),
    ).toMatchObject({
      identity: ['source', 'filename', 'checksum'],
    })
    const rootPackage = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(rootPackage.scripts.quality).toContain('pnpm run format:check')
    expect(rootPackage.scripts.build).toContain('pnpm --filter web')
    expect(rootPackage.scripts.test).toContain('playwright')
  })
})

describe('CLI argument parsing', () => {
  it('supports named options and exact local target resolution', async () => {
    const parsed = (await import('../src/cli.js')).parseCliArguments(
      ['--name', 'named-app', '--target-dir', 'output', '--local-port=3456', '--no-git'],
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
