import { execFile, execFileSync } from 'node:child_process'
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
import { runConsumerCommand } from './consumer-smoke-command.mjs'
import { consumerSmokePhases, mapPackages } from './consumer-smoke-phases.mjs'
import {
  assertConsumerDependencyScope,
  consumerSmokeGeneratorArgs,
} from './consumer-smoke-fixture.mjs'
import { consumerLockDigest, packedInput } from './packed-consumer-inputs.mjs'
import { subpathProbeProgram, subpathResolutionPlans } from './packed-consumer-subpaths.mjs'

import { loadWorkspace } from './compute-affected-packages.mjs'
import { assertHostedPlaywrightToolchain } from './hosted-playwright-toolchain.mjs'
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
const installBrowser = args.has('--install-browser')
const artifactsOnly = args.has('--artifacts-only')
if (artifactsOnly && !consumerSmoke) throw new Error('--artifacts-only requires --consumer-smoke.')
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

async function runChecked(command, commandArgs, options) {
  const label = options.label || `${command} ${commandArgs.join(' ')}`
  writeLine(`\n[consumer-smoke] ${label}`)
  const started = performance.now()
  let output
  try {
    output = await runConsumerCommand(command, commandArgs, {
      cwd: options.cwd,
      env: childEnvironment(options.env),
    })
  } catch (error) {
    throw new Error(`${label} failed (${error.signal || error.code || 'unknown exit'}).`, {
      cause: error,
    })
  } finally {
    timings.push({ label, seconds: (performance.now() - started) / 1000 })
    writeLine(`[consumer-smoke] Completed ${label} in ${timings.at(-1).seconds.toFixed(1)}s`)
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

// Preserve the fail-closed immutable-image proof for legacy isolated-pool
// execution. Hosted CI instead checks the downloaded toolchain below; both
// paths bind the real browser and native libraries into the reuse fingerprint.
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
    // Ships by default (components-library-plan.md item 4, narduk-libs#251),
    // so it is pinned exactly like every other required package here even
    // though it is not one of the `--capabilities` passed below.
    '@narduk-enterprises/narduk-shell',
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
  // No unhead pin: narduk-seo's Nuxt SEO modules accept Unhead 2 and 3
  // (narduk-libs#316), so the consumer keeps the Unhead its Nuxt resolves.
  rootManifest.pnpm.overrides = {
    ...(rootManifest.pnpm.overrides || {}),
    ...tarballOverrides,
  }
  writeFileSync(rootManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`)
}

function addLocalConsumerFonts(generatedDirectory) {
  const webDirectory = join(generatedDirectory, 'apps', 'web')
  const configPath = join(webDirectory, 'nuxt.config.ts')
  const config = readFileSync(configPath, 'utf8')
  const modules = /\bmodules:\s*\[/gu
  if ([...config.matchAll(modules)].length !== 1) {
    throw new Error('Expected one generated Nuxt modules list for the local font fixture.')
  }
  writeFileSync(
    join(webDirectory, 'packed-consumer-fonts.mjs'),
    readFileSync(new URL('./consumer-smoke-fonts.mjs', import.meta.url)),
  )
  writeFileSync(configPath, config.replace(modules, "$&'./packed-consumer-fonts.mjs',"))
}

function addPackedCoreUiRuntimeSmoke(generatedDirectory) {
  const loggingPlugin = join(
    generatedDirectory,
    'apps',
    'web',
    'app',
    'plugins',
    'logging.client.ts',
  )
  mkdirSync(dirname(loggingPlugin), { recursive: true })
  writeFileSync(
    loggingPlugin,
    [
      "import { createBrowserLogger } from '@narduk-enterprises/narduk-logging/browser'",
      '',
      'export default defineNuxtPlugin(() => {',
      "  const logger = createBrowserLogger({ service: 'packed-seo-browser', environment: 'test' })",
      "  logger.info('Synthetic logging check', { check: 'seo-browser' })",
      '})',
      '',
    ].join('\n'),
  )
  const appPath = join(generatedDirectory, 'apps', 'web', 'app', 'app.vue')
  writeFileSync(
    appPath,
    [
      '<template>',
      '  <UApp>',
      '    <LayerAppHeader app-name="Narduk Libs Release Smoke" />',
      // Proves the packed narduk-shell tarball, not just narduk-core: the
      // components-library suite ships to every generated app by default
      // (components-library-plan.md item 4, narduk-libs#251), and a generated
      // app that installs it but never renders an Ne* component has not been
      // tested. NeStatusBadge is the simplest registered component with no
      // slots and no optional-vs-required prop branching.
      '    <NeStatusBadge tone="ok" label="Packed OK" />',
      '    <NuxtLayout>',
      '      <NuxtPage />',
      '    </NuxtLayout>',
      '  </UApp>',
      '</template>',
      '',
    ].join('\n'),
  )
  // Extends the generator's own home.spec.ts (which only asserts the page
  // heading) with a real browser assertion that the packed narduk-shell
  // component actually rendered -- not just that `nuxt build` succeeded.
  const homeSpecPath = join(generatedDirectory, 'apps', 'web', 'tests', 'e2e', 'home.spec.ts')
  writeFileSync(
    homeSpecPath,
    [
      "import { expect, test } from '@playwright/test'",
      '',
      "test('home page renders', async ({ page }) => {",
      "  await page.goto('/')",
      "  await expect(page.getByRole('heading', { name: 'Narduk Libs Release Smoke' })).toBeVisible()",
      '})',
      '',
      "test('packed narduk-shell component renders', async ({ page }) => {",
      "  await page.goto('/')",
      "  await expect(page.getByText('Packed OK')).toBeVisible()",
      '})',
      '',
    ].join('\n'),
  )
}

// narduk-libs#295: `addPackedCoreUiRuntimeSmoke` above only proves the packed
// narduk-shell tarball installs and that a registered Ne* component renders
// through the module's own component auto-import -- neither exercises app
// code that writes `import { defineStatusMap } from '@narduk-enterprises/narduk-shell'`,
// which is exactly the line that failed a production `nuxt build` for the
// first real adopter (narduk-enterprises/buoys PR #44, within an hour of the
// 0.1.0 publish): `.` resolved straight to `src/module.ts`, which imports
// `@nuxt/kit`, and Nuxt's import-protection plugin refuses to let any
// app-bundled file that imports `@nuxt/kit` reach the client build.
//
// This page imports the package root's documented value exports
// (`defineStatusMap`, `NARDUK_SHELL_APP_CONFIG`) as VALUES from the bare
// `@narduk-enterprises/narduk-shell` specifier -- never from `./module` --
// the same way that failing line did. If a future change ever repoints `.`
// back at a file that pulls in `@nuxt/kit`, the `build` phase of
// `quality:static` (a real `nuxt build`, run before `test:unit`/`test:e2e`
// in the phase list `qualityPhases()` expands below) fails here, before this
// page is ever served. The Playwright assertion is the second half of the
// proof: it shows the values did not just survive the build, they executed
// and produced the right output.
function addPackedShellRootValueImportSmoke(generatedDirectory) {
  const pagePath = join(
    generatedDirectory,
    'apps',
    'web',
    'app',
    'pages',
    'narduk-shell-root-value-import.vue',
  )
  mkdirSync(dirname(pagePath), { recursive: true })
  writeFileSync(
    pagePath,
    [
      '<script setup lang="ts">',
      '// narduk-libs#295 gate -- see addPackedShellRootValueImportSmoke in',
      '// scripts/release-packages.mjs for why this page exists. Every import',
      "// below is a VALUE from the bare package specifier, never './module'.",
      "import { defineStatusMap, NARDUK_SHELL_APP_CONFIG } from '@narduk-enterprises/narduk-shell'",
      '',
      "type RootImportCheck = 'ok'",
      '',
      'const rootImportStatus = defineStatusMap<RootImportCheck>({',
      "  ok: ['ok', 'narduk-shell root value import OK'],",
      '})',
      '',
      "const descriptor = rootImportStatus('ok')",
      'const primaryColorAlias = NARDUK_SHELL_APP_CONFIG.ui.colors.primary',
      '</script>',
      '',
      '<template>',
      '  <div>',
      '    <h1>{{ descriptor.label }}</h1>',
      '    <p data-testid="root-config-alias">{{ primaryColorAlias }}</p>',
      '  </div>',
      '</template>',
      '',
    ].join('\n'),
  )

  const specPath = join(
    generatedDirectory,
    'apps',
    'web',
    'tests',
    'e2e',
    'narduk-shell-root-value-import.spec.ts',
  )
  mkdirSync(dirname(specPath), { recursive: true })
  writeFileSync(
    specPath,
    [
      "import { expect, test } from '@playwright/test'",
      '',
      "test('narduk-shell root value imports execute (narduk-libs#295)', async ({ page }) => {",
      "  await page.goto('/narduk-shell-root-value-import')",
      '  await expect(',
      "    page.getByRole('heading', { name: 'narduk-shell root value import OK' }),",
      '  ).toBeVisible()',
      "  await expect(page.getByTestId('root-config-alias')).toHaveText('sky')",
      '})',
      '',
    ].join('\n'),
  )

  classifyGeneratedFixturePage(
    generatedDirectory,
    'narduk-shell-root-value-import.vue',
    'narduk-libs#295 packed-consumer-smoke fixture proving the narduk-shell root value import; not real content',
  )
}

// The generator's own `og:check` step (wired into the generated app's `build`
// script: `narduk-app og:generate --if-missing && narduk-app og:check && nuxt
// build`) requires every `app/pages/*.vue` file to be classified in
// `Config/social-previews.json`, or the build fails before `nuxt build` -- and
// therefore before Playwright -- ever runs (see
// packages/tooling/create-narduk-app/src/social-previews.ts and
// checkRouteInventory in packages/tooling/narduk-app-tools/src/social/config.ts).
// A fixture page is release-pipeline plumbing, not real content, so it is
// classified `private` with a reason, exactly like the generator's own
// `/__preview/og-images` example -- that skips path/crawler checks entirely
// (checkRouteInventory: `if (route.kind === 'private') continue`) while still
// satisfying the per-file "every page is classified" requirement.
function classifyGeneratedFixturePage(generatedDirectory, source, reason) {
  const socialPreviewsConfigPath = join(
    generatedDirectory,
    'apps',
    'web',
    'Config',
    'social-previews.json',
  )
  const socialPreviewsConfig = JSON.parse(readFileSync(socialPreviewsConfigPath, 'utf8'))
  socialPreviewsConfig.routes.push({ source, kind: 'private', reason })
  // Re-serializing the whole config with plain `JSON.stringify` would
  // re-expand the pre-existing `"paths": ["/"]` entry back onto three lines,
  // failing the generated app's own `format:check` -- Prettier collapses a
  // short array like that onto one line, but does not collapse an object
  // (which is why the `private` routes above, with no `paths` field, need no
  // such fix-up). Re-apply the exact same collapsing this file was originally
  // written with in socialPreviewFiles
  // (packages/tooling/create-narduk-app/src/social-previews.ts) to keep the
  // untouched routes byte-identical to what Prettier already accepted.
  const rewritten = `${JSON.stringify(socialPreviewsConfig, null, 2).replaceAll(
    /("paths": )\[\n\s+("[^\n]+")\n\s+\]/gu,
    '$1[$2]',
  )}\n`
  writeFileSync(socialPreviewsConfigPath, rewritten)
}

// narduk-libs#316: the packed SEO module set has to be proven through a real
// browser, not just installed. This page calls the packed
// `useSeo`/`useWebPageSchema` composables the same way an adopting app does.
const PACKED_SEO_FIXTURE_PAGE = `<script setup lang="ts">
// narduk-libs#316 gate -- see addPackedSeoMetadataSmoke in
// scripts/release-packages.mjs for why this page exists. Both composables are
// auto-imported by the packed narduk-seo module.
const pageTitle = 'Packed SEO metadata'
const pageDescription = 'Packed narduk-seo renders SSR metadata, canonical links and JSON-LD.'

useSeo({
  title: pageTitle,
  description: pageDescription,
  canonicalUrl: '/narduk-seo-packed',
})

useWebPageSchema({
  name: pageTitle,
  description: pageDescription,
})
</script>

<template>
  <div>
    <h1>{{ pageTitle }}</h1>
    <p>{{ pageDescription }}</p>
    <NuxtLink to="/" data-testid="seo-packed-home-link">Home</NuxtLink>
  </div>
</template>
`

// The gate itself: server-rendered title, description, Open Graph meta (and
// the absence of every `twitter:*` name, narduk-libs#349), canonical link and
// WebPage JSON-LD, plus a client-side navigation that has to re-apply the head. The generated consumer resolves its own Nuxt, and
// therefore its own Unhead major, so this is what catches an Unhead-
// incompatible module set before it is published.
const PACKED_SEO_FIXTURE_SPEC = `import { expect, test } from '@playwright/test'

const pageTitle = 'Packed SEO metadata'
const pageDescription = 'Packed narduk-seo renders SSR metadata, canonical links and JSON-LD.'
const siteUrl = 'https://narduk-libs-release-smoke.invalid'
const canonical = \`\${siteUrl}/narduk-seo-packed\`

interface SchemaNode {
  '@id'?: string
  '@type'?: string
  description?: string
  name?: string
}

function metaContent(html: string, attribute: string, value: string) {
  const tag = new RegExp(\`<meta[^>]*\\\\b\${attribute}="\${value}"[^>]*>\`, 'u').exec(html)?.[0]
  return tag ? (/content="([^"]*)"/u.exec(tag)?.[1] ?? null) : null
}

// A trailing slash is the one canonical difference Nuxt SEO normalizes per
// site config, so compare normalized hrefs -- but still require every emitted
// canonical to agree, because a second, different canonical is a real defect.
function normalizeHref(href: string | null) {
  return (href ?? '').replace(/\\/$/u, '')
}

test('packed narduk-seo renders SSR metadata (narduk-libs#316)', async ({ request }) => {
  const response = await request.get('/narduk-seo-packed')
  expect(response.ok()).toBe(true)
  const html = await response.text()

  expect(/<title[^>]*>([^<]*)<\\/title>/u.exec(html)?.[1] ?? '').toContain(pageTitle)
  expect(metaContent(html, 'name', 'description')).toBe(pageDescription)
  expect(metaContent(html, 'property', 'og:title')).toBe(pageTitle)
  expect(metaContent(html, 'property', 'og:description')).toBe(pageDescription)
  expect(metaContent(html, 'property', 'og:url')).toBe(canonical)
  expect(metaContent(html, 'property', 'og:image:width')).toBe('1200')
  expect(metaContent(html, 'property', 'og:image:height')).toBe('630')
  // narduk-libs#349: the packed module set must render no \`twitter:*\` meta at
  // all. Unhead 3 reports every one of those names as deprecated, and the
  // warnings reach the browser console of every adopting app
  // (narduk-enterprises/buoys#111). nuxt-seo-utils and nuxt-og-image both
  // re-add their own twitter tags unless narduk-seo turns them off, so this
  // asserts the rendered head rather than just the composable's payload.
  expect(
    [...html.matchAll(/<meta[^>]*\\sname="(twitter:[^"]*)"/gu)].map(([, name]) => name),
  ).toEqual([])
  expect(metaContent(html, 'name', 'robots')).toContain('noindex')
  expect(response.headers()['x-robots-tag']).toContain('noindex')

  // Fetch the actual dynamic image on the preview origin. Its internal island
  // render must succeed while page and response noindex protection stays on.
  const imageUrl = new URL(metaContent(html, 'property', 'og:image')!)
  expect(imageUrl.pathname).toMatch(/^\\/_og\\//u)
  const image = await request.get(imageUrl.pathname + imageUrl.search)
  expect(image.ok()).toBe(true)
  expect(image.headers()['content-type']).toContain('image/png')
  expect([...(await image.body()).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

  const canonicals = [...html.matchAll(/<link[^>]*rel="canonical"[^>]*>/gu)].map(
    ([tag]) => /href="([^"]*)"/u.exec(tag)?.[1] ?? null,
  )
  expect(canonicals.length).toBeGreaterThan(0)
  expect([...new Set(canonicals.map(normalizeHref))]).toEqual([normalizeHref(canonical)])

  const blocks = [...html.matchAll(/<script[^>]*application\\/ld\\+json[^>]*>([\\s\\S]*?)<\\/script>/gu)]
  expect(blocks.length).toBeGreaterThan(0)
  const graph = blocks.flatMap(([, json]) => {
    const parsed = JSON.parse(json) as SchemaNode & { '@graph'?: SchemaNode[] }
    return parsed['@graph'] ?? [parsed]
  })
  const webPage = graph.find((node) => node['@type'] === 'WebPage')
  expect(webPage?.name).toBe(pageTitle)
  expect(webPage?.description).toBe(pageDescription)
  expect(webPage?.['@id'] ?? '').toContain('/narduk-seo-packed')
})

test('packed narduk-seo re-applies head on client navigation (narduk-libs#316)', async ({
  page,
}) => {
  await page.goto('/narduk-seo-packed')
  await expect(page.getByRole('heading', { name: pageTitle })).toBeVisible()
  await expect(page).toHaveTitle(new RegExp(pageTitle, 'u'))

  await page.getByTestId('seo-packed-home-link').click()
  await expect(page.getByRole('heading', { name: 'Narduk Libs Release Smoke' })).toBeVisible()
  await expect(page).toHaveTitle(/Narduk Libs Release Smoke/u)

  const canonicals = await page
    .locator('link[rel="canonical"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
  expect(canonicals.length).toBeGreaterThan(0)
  expect([...new Set(canonicals.map(normalizeHref))]).toEqual([normalizeHref(siteUrl)])
})
`

function addPackedSeoMetadataSmoke(generatedDirectory) {
  const configPath = join(generatedDirectory, 'apps', 'web', 'nuxt.config.ts')
  const config = readFileSync(configPath, 'utf8')
  const seoOptions = '  nardukSeo: {'
  if (config.split(seoOptions).length !== 2) {
    throw new Error('Packed SEO fixture requires exactly one generated nardukSeo config.')
  }
  writeFileSync(
    configPath,
    config.replace(seoOptions, `${seoOptions}\n    hostAwareIndexing: true,`),
  )

  const pagePath = join(generatedDirectory, 'apps', 'web', 'app', 'pages', 'narduk-seo-packed.vue')
  mkdirSync(dirname(pagePath), { recursive: true })
  writeFileSync(pagePath, PACKED_SEO_FIXTURE_PAGE)

  const specPath = join(
    generatedDirectory,
    'apps',
    'web',
    'tests',
    'e2e',
    'narduk-seo-packed.spec.ts',
  )
  mkdirSync(dirname(specPath), { recursive: true })
  writeFileSync(specPath, PACKED_SEO_FIXTURE_SPEC)

  classifyGeneratedFixturePage(
    generatedDirectory,
    'narduk-seo-packed.vue',
    'narduk-libs#316 packed-consumer-smoke fixture proving packed narduk-seo metadata; not real content',
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

async function proveGeneratedConsumer({
  consumerDirectory,
  packages,
  tarballs,
  browserInstallation,
}) {
  const generatedDirectory = join(consumerDirectory, 'generated-app')
  await runChecked('pnpm', consumerSmokeGeneratorArgs(generatedDirectory), {
    cwd: consumerDirectory,
    label: 'run the packed one-shot app generator',
  })

  const packagesByName = new Map(packages.map(({ manifest }) => [manifest.name, manifest]))
  assertExactGeneratedPackagePins(generatedDirectory, packagesByName)
  addTarballOverrides(generatedDirectory, packages, tarballs)
  addLocalConsumerFonts(generatedDirectory)
  addPackedCoreUiRuntimeSmoke(generatedDirectory)
  addPackedShellRootValueImportSmoke(generatedDirectory)
  addPackedSeoMetadataSmoke(generatedDirectory)
  assertNoForbiddenGeneratedReferences(generatedDirectory)
  assertConsumerDependencyScope(loadWorkspace(root), [
    readJson(join(generatedDirectory, 'package.json')),
    readJson(join(generatedDirectory, 'apps', 'web', 'package.json')),
  ])
  if (artifactsOnly) {
    writeLine(
      `Packed artifact proof passed for ${packages.length} package(s); generated app integration is not affected.`,
    )
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        '\n**Consumer coverage:** packed artifacts, export resolution, testkit execution, and generated manifests. Nuxt/browser/D1 integration is not affected; no reusable generated-app proof was produced.\n',
      )
    return
  }

  await runChecked('pnpm', ['install', '--no-frozen-lockfile'], {
    cwd: generatedDirectory,
    label: 'install the generated app from packed artifacts',
  })
  await runChecked('pnpm', ['install', '--frozen-lockfile'], {
    cwd: generatedDirectory,
    label: 'repeat generated app install with the frozen lockfile',
  })
  assertNoForbiddenGeneratedReferences(generatedDirectory)

  const [browserResult] = await browserInstallation
  if (browserResult?.status === 'rejected') throw browserResult.reason

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
    if (!process.env.GITHUB_ACTIONS) {
      await runChecked('pnpm', ['exec', 'playwright', 'install', 'chromium'], {
        cwd: generatedDirectory,
        label: 'install the generated app browser fixture',
      })
    }
    // Hosted CI installs Chromium and its native libraries before the proof.
    // Local runs still download a browser but do not create reusable evidence.
    if (process.env.GITHUB_ACTIONS) {
      imageIdentity = await assertHostedPlaywrightToolchain({
        cwd: generatedDirectory,
        expectedVersion: PLAYWRIGHT_TOOLCHAIN_VERSION,
      })
    }
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
    // The release boundary needs compatibility proof, not a second full
    // scaffold-quality run. The generated app's own quality command is intact.
    for (const phase of consumerSmokePhases(
      readJson(join(generatedDirectory, 'package.json')).scripts,
    )) {
      if (process.env.GITHUB_ACTIONS) writeLine(`::group::Generated app: ${phase}`)
      try {
        const output = await runChecked('pnpm', ['run', phase], {
          cwd: generatedDirectory,
          label: `generated app ${phase}`,
        })
        if (phase === 'build' && !output.includes('[consumer-smoke] Font providers: local only')) {
          throw new Error('The generated build did not activate its local-only font fixture.')
        }
      } finally {
        if (process.env.GITHUB_ACTIONS) writeLine('::endgroup::')
      }
    }
    assertNoRetiredBuiltReferences(generatedDirectory)

    const firstMigration = await runChecked('pnpm', ['run', 'db:migrate:local'], {
      cwd: generatedDirectory,
      label: 'apply generated app migrations to a fresh local D1 database',
    })
    const firstMigrationMatch = firstMigration.match(
      /\[db\]\s+(\d+) applied,\s+(\d+) adopted,\s+(\d+) skipped/u,
    )
    if (!firstMigrationMatch || Number(firstMigrationMatch[1]) < 1) {
      throw new Error('Fresh generated app migration did not apply at least one migration.')
    }

    const secondMigration = await runChecked('pnpm', ['run', 'db:migrate:local'], {
      cwd: generatedDirectory,
      label: 'prove generated app migrations are idempotent',
    })
    const secondMigrationMatch = secondMigration.match(
      /\[db\]\s+0 applied,\s+0 adopted,\s+(\d+) skipped/u,
    )
    if (!secondMigrationMatch || Number(secondMigrationMatch[1]) < 1) {
      throw new Error('Second generated app migration was not an empty idempotent run.')
    }

    await runChecked('pnpm', ['run', 'performance-budget'], {
      cwd: generatedDirectory,
      label: 'enforce generated app performance budgets',
    })
    const deployDryRun = await runChecked('pnpm', ['run', 'deploy:dry-run'], {
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

// Packing and both consumer installs do not need Chromium. Overlap the hosted
// download/native-library setup with that work even when every build is cached.
// Capture rejection immediately and drain it in finally on any early failure.
const browserInstallation = Promise.allSettled(
  installBrowser && !artifactsOnly
    ? [
        runChecked('pnpm', ['exec', 'playwright', 'install', '--with-deps', 'chromium'], {
          cwd: root,
          label: 'install Chromium and Linux browser dependencies',
          rejectWarnings: false,
        }),
      ]
    : [],
)

try {
  const tarballs = new Map()

  const packStarted = performance.now()
  const packed = await mapPackages(packages, async ({ directory, manifest }) => {
    const label = `validate and pack ${manifest.name}@${manifest.version}`
    writeLine(`[consumer-smoke] ${label}`)
    try {
      const pack = await execFileAsync('pnpm', ['pack', '--pack-destination', tarballDirectory], {
        cwd: directory,
        env: packEnvironment(),
        maxBuffer: 8 * 1024 * 1024,
      })
      const expectedTarball = `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`
      const path = join(tarballDirectory, expectedTarball)
      if (!existsSync(path)) throw new Error(`pnpm did not create a tarball for ${manifest.name}.`)
      // Lint exactly what the consumer will install. Linting the directory
      // first made publint run a second pnpm pack for every package.
      const lint = await execFileAsync('pnpm', ['exec', 'publint', path, '--strict'], {
        cwd: root,
        env: childEnvironment(),
        maxBuffer: 8 * 1024 * 1024,
      })
      return {
        name: manifest.name,
        path,
        output: `${pack.stdout}${pack.stderr}${lint.stdout}${lint.stderr}`,
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
          // The generated app and root must share one exact Playwright pin;
          // both downloaded and immutable-image proof paths assert it.
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

  await runChecked('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], {
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

  // Tier 1 -- every packed package that declares an `exports` map proves each
  // of its non-pattern subpaths both RESOLVES from the external consumer with
  // native Node ESM and points at a file the tarball actually contains. Before
  // narduk-libs#248 this ran for narduk-testkit only, so narduk-ui's
  // `./tokens.css`, narduk-charts's entry points and narduk-core's plain
  // subpaths were believed rather than proven: a subpath naming a file the
  // `files` allowlist omits installs cleanly and fails only in the app that
  // imports it. See scripts/packed-consumer-subpaths.mjs for why the existence
  // half is not redundant and why evaluation is NOT generalised here.
  const subpathPlans = subpathResolutionPlans(packages)
  if (subpathPlans.length === 0) {
    throw new Error('No packed package declares an exports map; the subpath tier would be vacuous.')
  }
  for (const plan of subpathPlans) {
    if (plan.skipped.length > 0) {
      writeLine(
        `[consumer-smoke] ${plan.name}: not probing ${plan.skipped
          .map(({ subpath, reason }) => `${subpath} (${reason})`)
          .join(', ')}`,
      )
    }
    if (plan.specifiers.length === 0) continue
    await runChecked(
      'node',
      ['--input-type=module', '--eval', subpathProbeProgram(plan.name, plan.specifiers)],
      {
        cwd: consumerDirectory,
        label: `resolve every packed ${plan.name} export subpath from the external consumer`,
      },
    )
  }

  // Tier 2 -- narduk-testkit additionally EVALUATES its subpaths. These two
  // groups are this gate's regression baseline and are deliberately unchanged
  // by the generalisation above; testkit is the one package whose subpaths are
  // plain built JavaScript with no Nuxt/Vue peer and no import-time side
  // effects, so importing them for real is both safe and meaningful.
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
    await runChecked(
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
  await runChecked('pnpm', ['exec', 'narduk-testkit', 'ui', 'analyze', testkitCliFixture], {
    cwd: consumerDirectory,
    label: 'execute the packed testkit CLI through built JavaScript',
  })

  await proveGeneratedConsumer({ consumerDirectory, packages, tarballs, browserInstallation })
} finally {
  // No installer may outlive cleanup, and no reusable proof is written unless
  // its result was checked at the browser/toolchain barrier above.
  await browserInstallation
  for (const { label, seconds } of timings)
    writeLine(`[consumer-smoke] Timing: ${label}: ${seconds.toFixed(1)}s`)
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### Consumer phase timings\n\n| Phase | Seconds |\n| --- | ---: |\n${timings.map(({ label, seconds }) => `| ${label} | ${seconds.toFixed(1)} |`).join('\n')}\n`,
    )
  rmSync(consumerDirectory, { recursive: true, force: true })
}
