import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { mapPackages, qualityPhases } from './consumer-smoke-phases.mjs'
import { consumerLockDigest, packedInput } from './packed-consumer-inputs.mjs'

import { loadWorkspace } from './compute-affected-packages.mjs'
import { collectWarningFindings, stripAnsi } from './consumer-smoke-output.mjs'
import {
  fileDigest,
  fingerprintInputs,
  lookupConsumerProof,
} from './reuse-packed-consumer-proof.mjs'

const execFileAsync = promisify(execFile)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const consumerSmoke = args.has('--consumer-smoke')
const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// Single source of truth for the generated packed-consumer's Playwright pin:
// the root workspace devDependency, which package.json already pins exactly
// to the pool-supported version (company-hq#343). Reading it here means a
// future pool upgrade only has to change one file, not this script too.
const PLAYWRIGHT_TOOLCHAIN_VERSION = rootManifest.devDependencies?.['@playwright/test']
if (!PLAYWRIGHT_TOOLCHAIN_VERSION) {
  throw new Error('Root package.json must directly pin devDependencies["@playwright/test"].')
}
// Same single-source-of-truth reasoning as Playwright above, added after PR
// #51 (run 30764151785) broke it: this consumer's own `eslint` devDependency
// used to be a hardcoded '9.39.4' literal, which was correct back when the
// whole workspace was on ESLint 9. That PR bumped root package.json and every
// sibling package to eslint@^10.8.0 and gave the new
// @narduk-enterprises/eslint-config package (a real `dependencies` entry of
// narduk-core, so it and its own eslint-plugin-unicorn peer range are always
// part of this install) a `peerDependencies.eslint: ^10.0.0` requirement --
// but the hardcoded literal here still resolved eslint to 9.39.4 in the
// packed consumer, so pnpm's peer-dependency check emitted WARN/✕ lines that
// runChecked() (rejectWarnings defaults to true) correctly turned into a hard
// failure. Reading the range straight from root/package.json keeps this pin
// from silently drifting out of sync with the workspace's actual ESLint
// major again.
const WORKSPACE_ESLINT_VERSION_RANGE = rootManifest.devDependencies?.eslint
if (!WORKSPACE_ESLINT_VERSION_RANGE) {
  throw new Error('Root package.json must directly pin devDependencies.eslint.')
}
// narduk-seo's Nuxt SEO plugins still peer on unhead 2. Nuxt 4.4 resolves
// unhead 3 unless the workspace override is applied. The packed-consumer
// sandbox is outside the workspace, so it must carry the same pin or pnpm
// emits WARN/✕ lines that runChecked() turns into a hard failure. @unhead/vue
// is a separate package with the same 2.x line; pin both from the workspace.
const WORKSPACE_UNHEAD_VERSION = rootManifest.pnpm?.overrides?.unhead
const WORKSPACE_UNHEAD_VUE_VERSION = rootManifest.pnpm?.overrides?.['@unhead/vue']
if (!WORKSPACE_UNHEAD_VERSION || !WORKSPACE_UNHEAD_VUE_VERSION) {
  throw new Error(
    'Root package.json must pin pnpm.overrides.unhead and pnpm.overrides["@unhead/vue"].',
  )
}

// narduk-core depends on nuxt-auth-utils, whose OPTIONAL passkey helpers still
// declare `@simplewebauthn/*@^11` — a range upstream has not moved since 2024.
// narduk-auth implements WebAuthn itself against its own exact-pinned v13
// (narduk-libs#125 D3) and never calls those helpers, so the two versions never
// meet at runtime. This sandbox is outside the workspace, so it must carry the
// same peer rule the workspace root declares or pnpm emits the WARN/✕ lines
// runChecked() turns into a hard failure. Read from root/package.json for the
// same reason as the pins above: one place to change.
const WORKSPACE_PEER_ALLOW_ANY = (rootManifest.pnpm?.peerDependencyRules?.allowAny ?? []).filter(
  (name) => name.startsWith('@simplewebauthn/'),
)
if (WORKSPACE_PEER_ALLOW_ANY.length === 0) {
  throw new Error(
    'Root package.json must list the @simplewebauthn/* packages in pnpm.peerDependencyRules.allowAny.',
  )
}

const writeLine = (message) => process.stdout.write(`${message}\n`)
const writeError = (message) => process.stderr.write(`${message}\n`)
const timings = []
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
  ['workspace:', 'link:', 'file:/', escapeRegExp(root)].join('|'),
  'i',
)
// `git+` in a lockfile is usually package `repository.url` metadata
// (`git+ssh://git@github.com/narduk-enterprises/narduk-libs.git`), not a git
// dependency. Only treat it as forbidden when it is a specifier or resolution.
const forbiddenGitDependencyLinePattern = /^\s*(?:specifier|version):\s*git\+|@[^\s'"]+@git\+/u

if (!dryRun) {
  writeError('Refusing to run without --dry-run; this helper never publishes packages.')
  process.exit(1)
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

function childEnvironment(overrides = {}) {
  const { NO_COLOR: _ignoredNoColor, ...environment } = process.env
  return { ...environment, ...overrides }
}

function runChecked(command, commandArgs, options) {
  const label = options.label || `${command} ${commandArgs.join(' ')}`
  writeLine(`\n[consumer-smoke] ${label}`)
  const started = performance.now()
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: childEnvironment(options.env),
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  timings.push({ label, seconds: (performance.now() - started) / 1000 })
  if (output) process.stdout.write(output)
  writeLine(`[consumer-smoke] Completed ${label} in ${timings.at(-1).seconds.toFixed(1)}s`)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`)
  }
  if (options.rejectWarnings !== false) {
    const findings = collectWarningFindings(output)
    if (findings.length > 0) {
      throw new Error(`${label} emitted warning/error output:\n${findings.join('\n')}`)
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
    const relativePath = relative(generatedDirectory, path)
    const contents = readFileSync(path, 'utf8')
    const retiredMatch = contents.match(retiredReferencePattern)
    if (retiredMatch) offenders.push(`${relativePath}: ${retiredMatch[0]}`)
    const sourceMatch = contents.match(forbiddenSourceReferencePattern)
    if (sourceMatch) offenders.push(`${relativePath}: ${sourceMatch[0]}`)
    if (basename(path) === 'pnpm-lock.yaml') {
      const gitDependencyLine = contents
        .split('\n')
        .find((line) => forbiddenGitDependencyLinePattern.test(line))
      if (gitDependencyLine) {
        offenders.push(`${relativePath}: ${gitDependencyLine.trim()}`)
      }
    } else if (/\bgit\+/iu.test(contents)) {
      offenders.push(`${relativePath}: git+`)
    }
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

// Fail-closed isolated-pool toolchain preflight (company-hq#343), adopted
// from the same idiom the narduk-enterprises/workflows shared callables run
// in their `Assert isolated Playwright toolchain` step
// (reusable-browser-tests.yml / nuxt-cloudflare.yml). packed-consumer-smoke
// is narduk-libs' only browser-launching lane -- it runs on the dedicated
// playwright-isolated pool but is a Node script, not a workflow YAML job, so
// this callable's browser preflight cannot be `uses:`-adopted directly; the
// exact same checks are reproduced here instead of left absent. It proves
// the generated consumer's exact @playwright/test pin, installed
// package/core versions, and browsers.json manifest all equal the immutable
// /opt/playwright-ci image, rejects a job-local browser path, then actually
// launches the selected executable as a canary -- all BEFORE `pnpm run
// quality` (which is what launches the real Playwright suite) ever starts.
async function assertIsolatedPlaywrightToolchain({ cwd, expectedVersion, requiredBrowsers }) {
  const rows = []
  const summary = process.env.GITHUB_STEP_SUMMARY
  const add = (label, value) =>
    rows.push(`| ${label} | \`${String(value).replaceAll('|', '\\|')}\` |`)
  const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
  const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
  const fail = (message) => {
    throw new Error(message)
  }
  const beneath = (path, base) => {
    const rel = relative(base, path)
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
  }
  const ownerUid = Number(process.env.PLAYWRIGHT_TOOLCHAIN_OWNER_UID ?? '0')
  const requireRootOwnedReadOnly = (path, label) => {
    const observed = statSync(path)
    if (observed.uid !== ownerUid || (observed.mode & 0o022) !== 0) {
      fail(`${label} is not root-owned and read-only: ${path}`)
    }
  }

  try {
    if (!Number.isInteger(ownerUid) || ownerUid < 0) fail('invalid toolchain owner uid')
    const imageRoot = resolve(process.env.PLAYWRIGHT_TOOLCHAIN_ROOT || '/opt/playwright-ci')
    const imagePackagePath = join(imageRoot, 'npm/node_modules/playwright/package.json')
    const imageManifestPath = join(imageRoot, 'npm/node_modules/playwright-core/browsers.json')
    const imageBrowsersRoot = realpathSync(join(imageRoot, 'browsers'))
    for (const [path, label] of [
      [imagePackagePath, 'image Playwright package'],
      [imageManifestPath, 'image browser manifest'],
      [imageBrowsersRoot, 'image browser root'],
    ]) {
      if (!existsSync(path)) fail(`${label} is missing: ${path}`)
      requireRootOwnedReadOnly(path, label)
    }

    const manifest = readJson(join(cwd, 'package.json'))
    const declared =
      manifest.devDependencies?.['@playwright/test'] ?? manifest.dependencies?.['@playwright/test']
    if (!declared) fail('generated consumer package.json must directly pin @playwright/test')
    if (declared !== expectedVersion) {
      fail(
        `generated consumer pin ${JSON.stringify(declared)} does not equal required exact version ${JSON.stringify(expectedVersion)}`,
      )
    }

    const localRequire = createRequire(join(cwd, 'package.json'))
    const testPackagePath = localRequire.resolve('@playwright/test/package.json')
    const testRequire = createRequire(testPackagePath)
    const playwrightPackagePath = testRequire.resolve('playwright/package.json')
    const playwrightRequire = createRequire(playwrightPackagePath)
    const corePackagePath = playwrightRequire.resolve('playwright-core/package.json')
    const consumerPackage = readJson(testPackagePath)
    const consumerPlaywrightPackage = readJson(playwrightPackagePath)
    const consumerCorePackage = readJson(corePackagePath)
    const consumerManifestPath = join(dirname(corePackagePath), 'browsers.json')
    const consumerManifest = readJson(consumerManifestPath)
    const imagePackage = readJson(imagePackagePath)
    const imageManifest = readJson(imageManifestPath)
    const consumerManifestSha = digest(consumerManifestPath)
    const imageManifestSha = digest(imageManifestPath)
    const versions = new Set([
      expectedVersion,
      consumerPackage.version,
      consumerPlaywrightPackage.version,
      consumerCorePackage.version,
      imagePackage.version,
    ])
    add('required Playwright', expectedVersion)
    add('consumer package pin', declared)
    add('installed @playwright/test', consumerPackage.version)
    add('installed playwright-core', consumerCorePackage.version)
    add('image Playwright', imagePackage.version)
    add('consumer browsers.json SHA-256', consumerManifestSha)
    add('image browsers.json SHA-256', imageManifestSha)
    if (versions.size !== 1) {
      fail(
        `Playwright version mismatch: expected=${expectedVersion}, test=${consumerPackage.version}, runtime=${consumerPlaywrightPackage.version}, core=${consumerCorePackage.version}, image=${imagePackage.version}`,
      )
    }
    if (consumerManifestSha !== imageManifestSha) {
      fail(`browser manifest mismatch: consumer=${consumerManifestSha}, image=${imageManifestSha}`)
    }

    const jobPath = process.env.PLAYWRIGHT_BROWSERS_PATH
    if (!jobPath || !isAbsolute(jobPath))
      fail('PLAYWRIGHT_BROWSERS_PATH must be the absolute image-backed guest path')
    const resolvedJobPath = resolve(jobPath)
    const forbiddenRoots = [process.env.RUNNER_TEMP, process.env.GITHUB_WORKSPACE]
      .filter(Boolean)
      .map((path) => resolve(path))
    if (forbiddenRoots.some((base) => beneath(resolvedJobPath, base))) {
      fail(`job-local browser path is forbidden: ${resolvedJobPath}`)
    }
    const allowedPrefix = resolve(process.env.PLAYWRIGHT_ALLOWED_BROWSER_PREFIX || '/opt')
    if (!beneath(resolvedJobPath, allowedPrefix)) {
      fail(`browser path must live under ${allowedPrefix}: ${resolvedJobPath}`)
    }

    const supported = {
      chromium: {
        manifestName: 'chromium-headless-shell',
        executableParts: ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
      },
      webkit: { manifestName: 'webkit', executableParts: ['pw_run.sh'] },
    }
    const requested = [...new Set(requiredBrowsers)]
    if (!requested.length) fail('at least one browser engine is required')
    const playwright = localRequire('@playwright/test')
    const executableDigests = {}
    for (const engineName of requested) {
      const selection = supported[engineName]
      if (!selection) fail(`unsupported isolated browser ${JSON.stringify(engineName)}`)
      const expected = consumerManifest.browsers.find(
        (item) => item.name === selection.manifestName,
      )
      const observed = imageManifest.browsers.find((item) => item.name === selection.manifestName)
      if (!expected || !observed)
        fail(`${selection.manifestName} is absent from a browser manifest`)
      if (
        expected.revision !== observed.revision ||
        expected.browserVersion !== observed.browserVersion
      ) {
        fail(`${engineName} revision mismatch`)
      }
      const selected = join(
        jobPath,
        `${selection.manifestName.replaceAll('-', '_')}-${observed.revision}`,
        ...selection.executableParts,
      )
      if (!existsSync(selected)) fail(`${engineName} executable is missing: ${selected}`)
      const realized = realpathSync(selected)
      if (!beneath(realized, imageBrowsersRoot))
        fail(`${engineName} executable escapes immutable image: ${realized}`)
      for (let path = realized; ; path = dirname(path)) {
        requireRootOwnedReadOnly(path, `${engineName} executable path`)
        if (path === imageBrowsersRoot) break
        if (path === dirname(path)) fail(`${engineName} ancestry did not reach image root`)
      }
      const engine = playwright[engineName]
      if (!engine?.launch) fail(`@playwright/test does not expose ${engineName}`)
      const browser = await engine.launch({ headless: true, executablePath: selected })
      try {
        const page = await browser.newPage()
        await page.setContent('<title>playwright-isolated-canary</title>')
        if ((await page.title()) !== 'playwright-isolated-canary') {
          fail(`${engineName} launch canary returned the wrong page title`)
        }
      } finally {
        await browser.close()
      }
      add(`${engineName} executable`, realized)
      add(`${engineName} launch canary`, 'passed')
      executableDigests[engineName] = fileDigest(realized)
    }
    add('status', 'PASS — exact immutable image toolchain selected; no installer invoked')
    writeLine(`Playwright toolchain matched image ${imagePackage.version} (${imageManifestSha})`)
    return {
      manifest: imageManifestSha,
      package: fileDigest(imagePackagePath),
      executables: executableDigests,
      os: fileDigest('/etc/os-release'),
      // Browser revision alone does not identify its native library inputs.
      systemPackages: createHash('sha256')
        .update(execFileSync('dpkg-query', ['-W', '-f=${binary:Package}=${Version}\n']))
        .digest('hex'),
    }
  } catch (error) {
    add('status', `FAIL — ${error.message}`)
    writeError(`Playwright toolchain mismatch: ${error.message}`)
    writeError(
      'Change the consumer exact pin or rebuild/promote the pool image; job-time browser download is forbidden.',
    )
    throw error
  } finally {
    if (summary) {
      appendFileSync(
        summary,
        `### Isolated Playwright toolchain (packed-consumer-smoke)\n\n| Field | Observed |\n|---|---|\n${rows.join('\n')}\n`,
      )
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
    unhead: WORKSPACE_UNHEAD_VERSION,
    '@unhead/vue': WORKSPACE_UNHEAD_VUE_VERSION,
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

    const shipsDist = (packedManifest.files || []).some(
      (entry) => entry === 'dist' || entry === 'dist/' || entry.startsWith('dist/'),
    )
    if (shipsDist) {
      const listing = execFileSync('tar', ['-tzf', tarball], {
        cwd: root,
        encoding: 'utf8',
      })
      if (!listing.split('\n').some((entry) => entry.startsWith('package/dist/'))) {
        throw new Error(
          `${manifest.name} declares files: dist but the packed tarball contains no package/dist/ entries.`,
        )
      }
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

/**
 * Consumer-smoke runs after an explicit coordinated turbo build. Re-running each
 * package's prepack/prepare during pnpm pack rebuilds the same artifacts a second
 * (and, with dry-run, a third) time on the playwright pool for zero proof gain.
 * Pack with lifecycle scripts suppressed, but fail closed if a package that ships
 * a compiled dist/ is missing that dist — so we never publish-shaped tarballs of
 * empty build output.
 */
function assertCompiledDistPresent(packages) {
  for (const { directory, manifest } of packages) {
    const files = manifest.files || []
    const shipsDist = files.some(
      (entry) => entry === 'dist' || entry === 'dist/' || entry.startsWith('dist/'),
    )
    if (!shipsDist) continue
    const distDirectory = join(directory, 'dist')
    if (!existsSync(distDirectory) || !statSync(distDirectory).isDirectory()) {
      throw new Error(
        `${manifest.name} ships dist/ but dist/ is missing. Run the coordinated package build before release:consumer-smoke.`,
      )
    }
    const distEntries = readdirSync(distDirectory)
    if (distEntries.length === 0) {
      throw new Error(
        `${manifest.name} ships dist/ but dist/ is empty. Run the coordinated package build before release:consumer-smoke.`,
      )
    }
  }
}

function packEnvironment() {
  // pnpm pack honors npm's ignore-scripts config and skips prepack/prepare.
  return childEnvironment({ npm_config_ignore_scripts: 'true' })
}

const packages = loadWorkspace(root)
  .packages.map(({ directory, manifest }) => ({ directory, manifest }))
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

  if (!consumerSmoke) {
    writeLine(`Checking ${manifest.name}@${manifest.version}`)
    execFileSync('pnpm', ['exec', 'publint', directory, '--strict'], {
      cwd: root,
      stdio: 'inherit',
    })
    execFileSync('pnpm', ['pack', '--dry-run'], { cwd: directory, stdio: 'inherit' })
  }
}

if (!consumerSmoke) {
  writeLine(`Dry run passed for ${packages.length} independent package(s).`)
  process.exit(0)
}

assertCompiledDistPresent(packages)
writeLine(
  `Packing ${packages.length} package(s) from coordinated build outputs (lifecycle scripts suppressed).`,
)

const consumerDirectory = mkdtempSync(join(tmpdir(), 'narduk-libs-consumer-'))
const tarballDirectory = join(consumerDirectory, 'tarballs')
const packageJsonPath = join(consumerDirectory, 'package.json')
mkdirSync(tarballDirectory, { recursive: true })

try {
  const tarballs = new Map()

  const packStarted = performance.now()
  const packed = await mapPackages(packages, async ({ directory, manifest }) => {
    const label = `validate and pack ${manifest.name}@${manifest.version}`
    writeLine(`[consumer-smoke] ${label}`)
    try {
      const lint = await execFileAsync('pnpm', ['exec', 'publint', directory, '--strict'], {
        cwd: root,
        env: childEnvironment(),
        maxBuffer: 8 * 1024 * 1024,
      })
      const pack = await execFileAsync('pnpm', ['pack', '--pack-destination', tarballDirectory], {
        cwd: directory,
        env: packEnvironment(),
        maxBuffer: 8 * 1024 * 1024,
      })
      const expectedTarball = `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`
      const path = join(tarballDirectory, expectedTarball)
      if (!existsSync(path)) throw new Error(`pnpm did not create a tarball for ${manifest.name}.`)
      return {
        name: manifest.name,
        path,
        output: `${lint.stdout}${lint.stderr}${pack.stdout}${pack.stderr}`,
      }
    } catch (error) {
      if (error.stdout) process.stdout.write(error.stdout)
      if (error.stderr) process.stderr.write(error.stderr)
      throw new Error(`${label} failed`, { cause: error })
    }
  })
  for (const { name, path, output } of packed) {
    tarballs.set(name, path)
    if (output) process.stdout.write(output)
  }
  timings.push({
    label: 'validate and pack all packages (two at a time)',
    seconds: (performance.now() - packStarted) / 1000,
  })

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
          // Must equal the pool-supported exact pin asserted by
          // assertIsolatedPlaywrightToolchain below and the repo's own root/
          // package devDependency pins (company-hq#343): the packed-consumer
          // smoke launches this generated app's real Playwright suite on the
          // playwright-isolated pool, and a stale pin here silently drifts
          // this dev-only sandbox package.json out of the immutable image's
          // supported version even though every other manifest is pinned.
          '@playwright/test': PLAYWRIGHT_TOOLCHAIN_VERSION,
          eslint: WORKSPACE_ESLINT_VERSION_RANGE,
          typescript: '5.9.3',
          vitest: '4.1.6',
        },
        pnpm: {
          overrides: {
            'eslint-plugin-vitest>@typescript-eslint/utils': '8.64.0',
            '@nuxt/eslint': '1.15.2',
            glob: '13.0.6',
          },
          peerDependencyRules: {
            allowAny: WORKSPACE_PEER_ALLOW_ANY,
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

  let imageIdentity
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    // Isolated-pool path: reject drift instead of trusting the env var alone.
    // A stale pin or a wrong/job-local PLAYWRIGHT_BROWSERS_PATH must fail
    // here, before `pnpm run quality` below ever launches the real suite.
    imageIdentity = await assertIsolatedPlaywrightToolchain({
      cwd: generatedDirectory,
      expectedVersion: PLAYWRIGHT_TOOLCHAIN_VERSION,
      requiredBrowsers: ['chromium'],
    })
  } else {
    runChecked('pnpm', ['exec', 'playwright', 'install', 'chromium'], {
      cwd: generatedDirectory,
      label: 'install the generated app browser fixture',
    })
  }
  // Resolve and install both external consumers before considering reuse. A
  // floating registry dependency or different installed package content forces execution,
  // even when GitHub reports identical source trees across the merge.
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  const packedInputs = new Map([...tarballs].map(([name, path]) => [name, packedInput(path)]))
  const proofInputs = {
    schemaVersion: 2,
    tree,
    tarballs: Object.fromEntries([...packedInputs].map(([name, input]) => [name, input.digest])),
    consumerLock: consumerLockDigest(join(consumerDirectory, 'pnpm-lock.yaml'), packedInputs),
    generatedSources: Object.fromEntries(
      listGeneratedTextFiles(generatedDirectory).map((path) => [
        relative(generatedDirectory, path),
        basename(path) === 'pnpm-lock.yaml'
          ? consumerLockDigest(path, packedInputs)
          : fileDigest(path),
      ]),
    ),
    node: {
      version: process.version,
      executable: fileDigest(process.execPath),
      platform: process.platform,
      arch: process.arch,
    },
    pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
    imageIdentity: imageIdentity ?? null,
    nodeOptions: process.env.NODE_OPTIONS || '',
  }
  const fingerprint = fingerprintInputs(proofInputs)
  const inputDigests = Object.fromEntries(
    Object.entries(proofInputs).map(([key, value]) => [key, fingerprintInputs(value)]),
  )
  const inputFiles = {
    tarballs: proofInputs.tarballs,
    generatedSources: proofInputs.generatedSources,
  }
  const prior = await lookupConsumerProof({ tree, fingerprint, inputDigests, inputFiles })
  if (prior) {
    writeLine(
      `[consumer-smoke] Reused generated-app proof from PR #${prior.pullRequest}, run ${prior.runId}, attempt ${prior.runAttempt}; exact installed inputs ${fingerprint}.`,
    )
  } else {
    for (const phase of qualityPhases(readJson(join(generatedDirectory, 'package.json')).scripts)) {
      if (process.env.GITHUB_ACTIONS) writeLine(`::group::Generated app: ${phase}`)
      try {
        runChecked('pnpm', ['run', phase], {
          cwd: generatedDirectory,
          label: `generated app ${phase}`,
        })
      } finally {
        if (process.env.GITHUB_ACTIONS) writeLine('::endgroup::')
      }
    }
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
  }

  if (process.env.GITHUB_RUN_ID && imageIdentity) {
    const evidenceDirectory = join(root, '.ci-evidence', 'packed-consumer-proof')
    mkdirSync(evidenceDirectory, { recursive: true })
    writeFileSync(
      join(evidenceDirectory, 'proof.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: prior ? 'reused' : 'executed',
          repository: process.env.GITHUB_REPOSITORY,
          runId: Number(process.env.GITHUB_RUN_ID),
          runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
          tree,
          fingerprint,
          inputDigests,
          inputFiles,
          completedAt: new Date().toISOString(),
          ...(prior ? { prior } : {}),
        },
        null,
        2,
      )}\n`,
    )
  }

  writeLine(
    `Packed consumer smoke passed for ${packages.length} package(s) and the generated Nuxt/Cloudflare/D1 fixture.`,
  )
} finally {
  for (const { label, seconds } of timings)
    writeLine(`[consumer-smoke] Timing: ${label}: ${seconds.toFixed(1)}s`)
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### Consumer phase timings\n\n| Phase | Seconds |\n| --- | ---: |\n${timings.map(({ label, seconds }) => `| ${label} | ${seconds.toFixed(1)} |`).join('\n')}\n`,
    )
  rmSync(consumerDirectory, { recursive: true, force: true })
}
