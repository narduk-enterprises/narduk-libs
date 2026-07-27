import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(root, 'packages')
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const consumerSmoke = args.has('--consumer-smoke')

const writeLine = (message) => process.stdout.write(`${message}\n`)
const writeError = (message) => process.stderr.write(`${message}\n`)
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ignoredGeneratedDirectories = new Set([
  '.git',
  '.nuxt',
  '.output',
  '.wrangler',
  'node_modules',
  'playwright-report',
  'test-results',
])
const retiredReferencePattern = new RegExp(
  [
    'narduk-template',
    'narduk-nuxt-template',
    'narduk-fleet',
    'narduk-cli',
    'narduk-starter-toolkit',
    'narduk-nuxt-module',
    '\\.template-reference',
    '\\.template-version',
    'narduk\\.layout\\.json',
    'guardrail-exceptions\\.json',
    'scripts/narduk-toolchain\\.mjs',
    'provision\\.json',
    '#layer',
    '#server/(?:app|core)-orm-tables',
    'command\\.nard\\.uk',
    'CONTROL_PLANE_URL',
    '/api/control-plane',
    'templateManaged',
    'site\\.webmanifest',
    'service-worker',
    'serviceWorker',
  ].join('|'),
  'i',
)
const forbiddenSourceReferencePattern = new RegExp(
  ['workspace:', 'link:', 'file:/', 'git\\+', escapeRegExp(root)].join('|'),
  'i',
)
const warningOrErrorTokenPattern =
  /(?:^|[\s:[(])(?:warn(?:ing)?|error)(?=$|[\s:\])])|(?:deprecation|experimental|MaxListenersExceeded)Warning:/iu

if (!dryRun) {
  writeError('Refusing to run without --dry-run; this helper never publishes packages.')
  process.exit(1)
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

function childEnvironment(overrides = {}) {
  const { NO_COLOR: _ignoredNoColor, ...environment } = process.env
  return { ...environment, ...overrides }
}

function stripAnsi(value) {
  return value.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
}

function runChecked(command, commandArgs, options) {
  const label = options.label || `${command} ${commandArgs.join(' ')}`
  writeLine(`\n[consumer-smoke] ${label}`)
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: childEnvironment(options.env),
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (output) process.stdout.write(output)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`)
  }
  if (options.rejectWarnings !== false) {
    const findings = stripAnsi(output)
      .split('\n')
      .filter((line) => warningOrErrorTokenPattern.test(line))
    if (findings.length > 0) {
      throw new Error(
        `${label} emitted warning/error output:\n${findings.map((line) => line.trim()).join('\n')}`,
      )
    }
  }
  return stripAnsi(output)
}

function relativeFileSpecifier(fromDirectory, targetPath) {
  const relativePath = relative(fromDirectory, targetPath).replaceAll('\\', '/')
  return `file:${relativePath.startsWith('.') ? relativePath : `./${relativePath}`}`
}

function listGeneratedTextFiles(directory, options = {}) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (ignoredGeneratedDirectories.has(entry.name)) continue
      files.push(...listGeneratedTextFiles(entryPath, options))
      continue
    }
    if (!entry.isFile() || statSync(entryPath).size > 2 * 1024 * 1024) continue
    if (
      options.extensions &&
      !options.extensions.some((extension) => entry.name.endsWith(extension))
    ) {
      continue
    }
    files.push(entryPath)
  }
  return files
}

function assertNoForbiddenGeneratedReferences(generatedDirectory) {
  const offenders = []
  for (const path of listGeneratedTextFiles(generatedDirectory)) {
    const contents = readFileSync(path, 'utf8')
    const retiredMatch = contents.match(retiredReferencePattern)
    if (retiredMatch) offenders.push(`${relative(generatedDirectory, path)}: ${retiredMatch[0]}`)
    const sourceMatch = contents.match(forbiddenSourceReferencePattern)
    if (sourceMatch) offenders.push(`${relative(generatedDirectory, path)}: ${sourceMatch[0]}`)
  }
  if (offenders.length > 0) {
    throw new Error(`Generated consumer contains forbidden references:\n${offenders.join('\n')}`)
  }
}

function assertNoRetiredBuiltReferences(generatedDirectory) {
  const outputDirectory = join(generatedDirectory, 'apps', 'web', '.output')
  if (!existsSync(join(outputDirectory, 'server', 'index.mjs'))) {
    throw new Error('Generated consumer did not produce a Cloudflare Worker server entrypoint.')
  }
  const extensions = ['.css', '.html', '.js', '.json', '.mjs', '.txt', '.xml']
  const offenders = []
  for (const path of listGeneratedTextFiles(outputDirectory, { extensions })) {
    const contents = readFileSync(path, 'utf8')
    const match = contents.match(retiredReferencePattern)
    if (match) offenders.push(`${relative(generatedDirectory, path)}: ${match[0]}`)
  }
  if (offenders.length > 0) {
    throw new Error(`Built consumer contains retired references:\n${offenders.join('\n')}`)
  }
  for (const retiredAsset of ['apple-touch-icon.png', 'site.webmanifest']) {
    if (existsSync(join(outputDirectory, 'public', retiredAsset))) {
      throw new Error(`Generated consumer unexpectedly built retired PWA asset ${retiredAsset}.`)
    }
  }
}

function assertExactGeneratedPackagePins(generatedDirectory, packagesByName) {
  const requiredPackages = new Set([
    '@narduk-enterprises/narduk-ai',
    '@narduk-enterprises/narduk-analytics',
    '@narduk-enterprises/narduk-app-tools',
    '@narduk-enterprises/narduk-auth',
    '@narduk-enterprises/narduk-core',
    '@narduk-enterprises/narduk-seo',
    '@narduk-enterprises/narduk-testkit',
    '@narduk-enterprises/narduk-uploads',
  ])
  const seenPackages = new Set()

  for (const manifestPath of [
    join(generatedDirectory, 'package.json'),
    join(generatedDirectory, 'apps', 'web', 'package.json'),
  ]) {
    const manifest = readJson(manifestPath)
    for (const section of ['dependencies', 'devDependencies']) {
      for (const [name, version] of Object.entries(manifest[section] || {})) {
        const packageManifest = packagesByName.get(name)
        if (!packageManifest) continue
        seenPackages.add(name)
        if (version !== packageManifest.version) {
          throw new Error(
            `Generated ${relative(generatedDirectory, manifestPath)} pins ${name} to ${version}; expected exact local version ${packageManifest.version}.`,
          )
        }
      }
    }
  }

  const missingPackages = [...requiredPackages].filter((name) => !seenPackages.has(name))
  if (missingPackages.length > 0) {
    throw new Error(
      `Generated all-capability app is missing required package pins: ${missingPackages.join(', ')}.`,
    )
  }
}

function addTarballOverrides(generatedDirectory, packages, tarballs) {
  const rootManifestPath = join(generatedDirectory, 'package.json')
  const rootManifest = readJson(rootManifestPath)
  const tarballOverrides = Object.fromEntries(
    packages.map(({ manifest }) => [
      manifest.name,
      relativeFileSpecifier(generatedDirectory, tarballs.get(manifest.name)),
    ]),
  )

  rootManifest.pnpm = rootManifest.pnpm || {}
  rootManifest.pnpm.overrides = {
    ...(rootManifest.pnpm.overrides || {}),
    ...tarballOverrides,
  }
  writeFileSync(rootManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`)
}

function addPackedCoreUiRuntimeSmoke(generatedDirectory) {
  const appPath = join(generatedDirectory, 'apps', 'web', 'app', 'app.vue')
  writeFileSync(
    appPath,
    [
      '<template>',
      '  <UApp>',
      '    <LayerAppHeader app-name="Narduk Libs Release Smoke" />',
      '    <NuxtLayout>',
      '      <NuxtPage />',
      '    </NuxtLayout>',
      '  </UApp>',
      '</template>',
      '',
    ].join('\n'),
  )
}

function assertPackedInternalDependencyGraph(packages, tarballs) {
  const packagesByName = new Map(packages.map(({ manifest }) => [manifest.name, manifest]))

  for (const { manifest } of packages) {
    const tarball = tarballs.get(manifest.name)
    const packedManifest = JSON.parse(
      execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
        cwd: root,
        encoding: 'utf8',
      }),
    )

    if (packedManifest.name !== manifest.name || packedManifest.version !== manifest.version) {
      throw new Error(
        `Packed manifest identity mismatch for ${manifest.name}: received ${packedManifest.name}@${packedManifest.version}.`,
      )
    }

    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const [dependencyName, dependencyVersion] of Object.entries(
        packedManifest[section] || {},
      )) {
        const localDependency = packagesByName.get(dependencyName)
        if (!localDependency) continue
        if (dependencyVersion !== localDependency.version) {
          throw new Error(
            `${manifest.name}@${manifest.version} packs ${section}.${dependencyName} as ${dependencyVersion}; expected the exact coordinated version ${localDependency.version}.`,
          )
        }
      }
    }
  }
}

const packages = readdirSync(packageRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const directory = join(packageRoot, entry.name)
    const manifest = readJson(join(directory, 'package.json'))
    return { directory, manifest }
  })
  .filter(({ manifest }) => manifest.private !== true)
  .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))

if (packages.length === 0) {
  writeError('No publishable packages found under packages/.')
  process.exit(1)
}

for (const { directory, manifest } of packages) {
  if (!manifest.name?.startsWith('@narduk-enterprises/')) {
    throw new Error(`Package ${directory} is outside the @narduk-enterprises scope.`)
  }
  if (!manifest.version) {
    throw new Error(`Package ${manifest.name} has no version.`)
  }
  if (manifest.publishConfig?.registry !== 'https://npm.pkg.github.com') {
    throw new Error(`Package ${manifest.name} must publish to GitHub Packages.`)
  }

  writeLine(`Checking ${manifest.name}@${manifest.version}`)
  execFileSync('pnpm', ['exec', 'publint', directory, '--strict'], {
    cwd: root,
    stdio: 'inherit',
  })
  // Consumer smoke creates and installs the real tarball immediately below;
  // keep the listing-only pack for the standalone dry-run path.
  if (!consumerSmoke) {
    execFileSync('pnpm', ['pack', '--dry-run'], { cwd: directory, stdio: 'inherit' })
  }
}

if (!consumerSmoke) {
  writeLine(`Dry run passed for ${packages.length} independent package(s).`)
  process.exit(0)
}

const consumerDirectory = mkdtempSync(join(tmpdir(), 'narduk-libs-consumer-'))
const tarballDirectory = join(consumerDirectory, 'tarballs')
const packageJsonPath = join(consumerDirectory, 'package.json')
mkdirSync(tarballDirectory, { recursive: true })

try {
  const tarballs = new Map()

  for (const { directory, manifest } of packages) {
    execFileSync('pnpm', ['pack', '--pack-destination', tarballDirectory], {
      cwd: directory,
      stdio: 'inherit',
    })
    const expectedTarball = `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`
    const tarball = readdirSync(tarballDirectory).find((entry) => entry === expectedTarball)
    if (!tarball) {
      throw new Error(`pnpm did not create a tarball for ${manifest.name}.`)
    }
    tarballs.set(manifest.name, join(tarballDirectory, tarball))
  }

  assertPackedInternalDependencyGraph(packages, tarballs)

  const dependencies = Object.fromEntries(
    packages.map(({ manifest }) => [
      manifest.name,
      relativeFileSpecifier(consumerDirectory, tarballs.get(manifest.name)),
    ]),
  )
  writeFileSync(
    packageJsonPath,
    `${JSON.stringify(
      {
        name: 'narduk-libs-packed-consumer-smoke',
        private: true,
        packageManager: 'pnpm@10.33.4',
        dependencies,
        devDependencies: {
          '@playwright/test': '1.59.1',
          eslint: '9.39.4',
          typescript: '5.9.3',
          vitest: '4.1.6',
        },
        pnpm: {
          overrides: {
            'eslint-plugin-vitest>@typescript-eslint/utils': '8.64.0',
            '@nuxt/eslint': '1.15.2',
            glob: '13.0.6',
          },
        },
      },
      null,
      2,
    )}\n`,
  )
  addTarballOverrides(consumerDirectory, packages, tarballs)

  runChecked('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], {
    cwd: consumerDirectory,
    label: 'install every packed package in an external consumer',
  })

  for (const { manifest } of packages) {
    const installedManifestPath = join(
      consumerDirectory,
      'node_modules',
      '@narduk-enterprises',
      manifest.name.slice('@narduk-enterprises/'.length),
      'package.json',
    )
    const installedManifest = readJson(installedManifestPath)
    if (
      installedManifest.name !== manifest.name ||
      installedManifest.version !== manifest.version
    ) {
      throw new Error(`Packed consumer resolved the wrong artifact for ${manifest.name}.`)
    }
  }

  const testkitManifest = packages.find(
    ({ manifest }) => manifest.name === '@narduk-enterprises/narduk-testkit',
  )?.manifest
  if (!testkitManifest) throw new Error('The release set is missing narduk-testkit.')
  const testkitExportSpecifiers = Object.keys(testkitManifest.exports || {}).map((subpath) =>
    subpath === '.' ? testkitManifest.name : `${testkitManifest.name}${subpath.slice(1)}`,
  )
  const testkitExportGroups = [
    {
      label: 'Playwright and analyzer',
      specifiers: testkitExportSpecifiers.filter(
        (specifier) => !specifier.includes('/server/kit/'),
      ),
    },
    {
      label: 'Vitest server-kit',
      specifiers: testkitExportSpecifiers.filter((specifier) => specifier.includes('/server/kit/')),
    },
  ]
  for (const group of testkitExportGroups) {
    if (group.specifiers.length === 0) continue
    runChecked(
      'node',
      [
        '--input-type=module',
        '--eval',
        `const specifiers = ${JSON.stringify(group.specifiers)}; for (const specifier of specifiers) await import(specifier); console.log(\`Imported \${specifiers.length} ${group.label} narduk-testkit export subpaths.\`)`,
      ],
      {
        cwd: consumerDirectory,
        label: `import packed testkit ${group.label} exports with native Node ESM`,
      },
    )
  }

  const testkitCliFixture = join(consumerDirectory, 'testkit-cli-fixture')
  mkdirSync(testkitCliFixture, { recursive: true })
  writeFileSync(
    join(testkitCliFixture, 'manifest.json'),
    `${JSON.stringify({ app: 'release-smoke', minimumScreenshotCount: 1 }, null, 2)}\n`,
  )
  writeFileSync(
    join(testkitCliFixture, 'screenshot.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAMgAAAB4CAYAAAC3kr3rAAAACXBIWXMAAAsTAAALEwEAmpwYAAAD2UlEQVR4nO3YsY0dQRDE0MpGMjofpacwFIkunC97fAHkATQqgQYfdjHbrz+f5rnB52vty3OD0UG0gHwEEALyTTDSQbT1BaERBGTfBmK/WAIUfUGGQwiIIP6ADA8+IILIAzI87IAIYg7I8IADIog2IMNDDYggTsPoINqeG/SKJUARkGlhBkSAIiDDIQREEH9AhgcfEEHkARkedkAEMQdkeMABEUQbkOGhBkQQp2F0EG3PDXrFEqAIyLQwAyJAEZDhEAIiiD8gw4MPiCDygAwPOyCCmAMyPOCACKINyPBQAyKI0zA6iLbnBr1iCVAEZFqYARGgCMhwCAERxB+Q4cEHRBB5QIaHHRBBzAEZHnBABNEGZHioARHEaRgdRNtzg16xBCgCMi3MgAhQBGQ4hIAI4g/I8OADIog8IMPDDogg5oAMDzgggmgDMjzUgAjiNIwOou25Qa9YAhQBmRZmQAQoAjIcQkAE8QdkePABEUQekOFhB0QQc0CGBxwQQbQBGR5qQARxGkYH0fbcoFcsAYqATAszIAIUARkOISCC+AMyPPiACCIPyPCwAyKIOSDDAw6IINqADA81III4DaODaHtu0CuWAEVApoUZEAGKgAyHEBBB/AEZHnxABJEHZHjYARHEHJDhAQdEEG1AhocaEEGchtFBtD036BVLgCIg08Lc3x8/P81zg/t97bfnBgERoAjI4RACIog/IIcHHxBB5AE5POyACGIOyOEBB0QQbUAODzUggjgNo4No99ygVywBioCcFmZABCgCcjiEgAjiD8jhwQdEEHlADg87IIKYA3J4wAERRBuQw0MNiCBOw+gg2j036BVLgCIgp4UZEAGKgBwOISCC+ANyePABEUQekMPDDogg5oAcHnBABNEG5PBQAyKI0zA6iHbPDXrFEqAIiBdmQAQoAnI4hIAI4g/I4cEHRBB5QA4POyCCmANyeMABEUQbkMNDDYggTsPoINo9N+gVS4AiIKeFGRABioAcDiEggvgDcnjwARFEHpDDww6IIOaAHB5wQATRBuTwUAMiiNMwOoh2zw16xRKgCMhpYQZEgCIgh0MIiCD+gBwefEAEkQfk8LADIog5IIcHHBBBtAE5PNSACOI0jA6i3XODXrEEKAJyWpgBEaAIyOEQAiKIPyCHBx8QQeQBOTzsgAhiDsjhAQdEEG1ADg81III4DaODaPfcoFcsAYqAnBZmQAQoAnI4hIAI4g/I4cEHRBB5QA4POyCCmANyeMABEUQbkMNDDYggTsPoINo9N+gVS4AiIKeFGRABioAcDiEggvgDcnjwARFEHpDDw/5f+wc9aM1vnZOdTgAAAABJRU5ErkJggg==',
      'base64',
    ),
  )
  runChecked('pnpm', ['exec', 'narduk-testkit', 'ui', 'analyze', testkitCliFixture], {
    cwd: consumerDirectory,
    label: 'execute the packed testkit CLI through built JavaScript',
  })

  const generatedDirectory = join(consumerDirectory, 'generated-app')
  runChecked(
    'pnpm',
    [
      'exec',
      'create-narduk-app',
      'narduk-libs-release-smoke',
      '--display-name=Narduk Libs Release Smoke',
      '--description=Tarball-only generated release consumer',
      '--site-url=https://narduk-libs-release-smoke.invalid',
      `--target-dir=${generatedDirectory}`,
      '--capabilities=auth,seo,analytics,uploads,ai',
      '--visibility=private',
      '--local-dev-port=3199',
      '--json',
      '--no-git',
    ],
    {
      cwd: consumerDirectory,
      label: 'run the packed one-shot app generator',
    },
  )

  const packagesByName = new Map(packages.map(({ manifest }) => [manifest.name, manifest]))
  assertExactGeneratedPackagePins(generatedDirectory, packagesByName)
  addTarballOverrides(generatedDirectory, packages, tarballs)
  addPackedCoreUiRuntimeSmoke(generatedDirectory)
  assertNoForbiddenGeneratedReferences(generatedDirectory)

  runChecked('pnpm', ['install', '--no-frozen-lockfile'], {
    cwd: generatedDirectory,
    label: 'install the generated app from packed artifacts',
  })
  runChecked('pnpm', ['install', '--frozen-lockfile'], {
    cwd: generatedDirectory,
    label: 'repeat generated app install with the frozen lockfile',
  })
  assertNoForbiddenGeneratedReferences(generatedDirectory)

  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    console.log(
      `[consumer-smoke] using host-provided Playwright browsers at ${process.env.PLAYWRIGHT_BROWSERS_PATH}; skipping browser download`,
    )
  } else {
    runChecked('pnpm', ['exec', 'playwright', 'install', 'chromium'], {
      cwd: generatedDirectory,
      label: 'install the generated app browser fixture',
    })
  }
  runChecked('pnpm', ['run', 'quality'], {
    cwd: generatedDirectory,
    label: 'run generated app formatting, lint, typecheck, build, unit, and browser gates',
  })
  assertNoRetiredBuiltReferences(generatedDirectory)

  const firstMigration = runChecked('pnpm', ['run', 'db:migrate:local'], {
    cwd: generatedDirectory,
    label: 'apply generated app migrations to a fresh local D1 database',
  })
  const firstMigrationMatch = firstMigration.match(
    /\[db\]\s+(\d+) applied,\s+(\d+) adopted,\s+(\d+) skipped/u,
  )
  if (!firstMigrationMatch || Number(firstMigrationMatch[1]) < 1) {
    throw new Error('Fresh generated app migration did not apply at least one migration.')
  }

  const secondMigration = runChecked('pnpm', ['run', 'db:migrate:local'], {
    cwd: generatedDirectory,
    label: 'prove generated app migrations are idempotent',
  })
  const secondMigrationMatch = secondMigration.match(
    /\[db\]\s+0 applied,\s+0 adopted,\s+(\d+) skipped/u,
  )
  if (!secondMigrationMatch || Number(secondMigrationMatch[1]) < 1) {
    throw new Error('Second generated app migration was not an empty idempotent run.')
  }

  runChecked('pnpm', ['run', 'performance-budget'], {
    cwd: generatedDirectory,
    label: 'enforce generated app performance budgets',
  })
  const deployDryRun = runChecked('pnpm', ['run', 'deploy:dry-run'], {
    cwd: generatedDirectory,
    label: 'build the generated Worker with Wrangler deploy dry-run',
  })
  if (!deployDryRun.includes('--dry-run: exiting now.')) {
    throw new Error('Wrangler deploy dry-run did not report a completed credential-free exit.')
  }
  assertNoForbiddenGeneratedReferences(generatedDirectory)

  writeLine(
    `Packed consumer smoke passed for ${packages.length} package(s) and the generated Nuxt/Cloudflare/D1 fixture.`,
  )
} finally {
  rmSync(consumerDirectory, { recursive: true, force: true })
}
