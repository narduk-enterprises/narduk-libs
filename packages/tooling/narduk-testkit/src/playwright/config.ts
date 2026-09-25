/**
 * Playwright `setup` / `pr` / `web` tier preset (narduk-libs#434).
 *
 * Loaded from a Playwright CONFIG, before the runner exists. It must not
 * import `e2e/fixtures` (that file calls `test.extend` at module scope) and
 * must not import `@playwright/test` at runtime — the app already has
 * `devices` and passes `browserUse` in. Same CJS-config constraint as
 * `playwright/dev-port` (#417).
 *
 * The silent dual-attach bug: a spec with no tier declaration is collected
 * by every project. That is how Buoys' PR suite grew 10 → 36. A spec
 * declares its tier in the filename (`.pr.spec.ts`, `.web.spec.ts`, or
 * `.pr-web.spec.ts` for both). Undeclared `*.spec.ts` files match no
 * project and fail {@link assertE2eSpecTiers}.
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { QUARANTINE_GREP, QUARANTINE_PROJECT_NAME, isQuarantineProjectName } from './quarantine.js'

export {
  GATE_PROJECT_NAMES,
  QUARANTINE_GREP,
  QUARANTINE_PROJECT_NAME,
  QUARANTINE_TAG,
  assertPlaywrightQuarantineCollection,
  collectedTestDeclaresQuarantine,
  parsePlaywrightJsonList,
  parsePlaywrightListOutput,
  quarantineDetails,
  sourceDeclaresQuarantineTag,
  testSourceAtLine,
  titleDeclaresQuarantineTag,
} from './quarantine.js'

/*
 * Pure helpers from the `narduk-testkit e2e` runner (#997), for apps that keep
 * a custom runner script. `e2e-runner` imports nothing from this file.
 */
export { resolveBrowserCachePath, withDefaultProject } from './e2e-runner.js'

/** Measured on the Buoys `e2e-parallel-config` experiment, 2026-09-17. */
export const NARDUK_PLAYWRIGHT_WORKERS = 2

export const NARDUK_PLAYWRIGHT_FULLY_PARALLEL = true

export const SETUP_PROJECT_NAME = 'setup'
export const PR_PROJECT_NAME = 'pr'
export const WEB_PROJECT_NAME = 'web'
/** One-release alias so generated CI `--project=chromium` still runs the web tier. */
export const CHROMIUM_PROJECT_ALIAS = 'chromium'

export const SETUP_TEST_MATCH = /(?:^|[/\\])global\.setup\.[cm]?[jt]sx?$/
export const PR_TEST_MATCH = /\.pr(?:-web)?\.spec\.[cm]?[jt]sx?$/
export const WEB_TEST_MATCH = /(?:\.web|\.pr-web)\.spec\.[cm]?[jt]sx?$/
/** Tagged flakes from either tier; `grep` is what selects them. */
export const QUARANTINE_TEST_MATCH = /\.(?:pr(?:-web)?|web)\.spec\.[cm]?[jt]sx?$/

export const ESTATE_VIEWPORTS = [
  { height: 900, name: 'desktop', width: 1280 },
  { height: 844, name: 'mobile', width: 390 },
  { height: 1024, name: 'tablet', width: 768 },
  { height: 960, name: 'wide', width: 1536 },
] as const

export const DEFAULT_PR_VIEWPORT_NAMES = ['desktop', 'mobile'] as const
export const DEFAULT_WEB_VIEWPORT_NAMES = ['desktop', 'mobile', 'tablet', 'wide'] as const

export type E2eDeclaredTier = 'setup' | 'pr' | 'web' | 'pr-web'
export type E2eFileClass = E2eDeclaredTier | 'undeclared'

export interface NardukPlaywrightProjectMetadata {
  e2eTier: 'setup' | 'pr' | 'web' | 'quarantine'
  visualAuditViewports: readonly string[]
}

export interface NardukPlaywrightProject {
  dependencies?: string[]
  grep?: RegExp
  grepInvert?: RegExp
  metadata?: NardukPlaywrightProjectMetadata
  name: string
  testIgnore?: RegExp
  testMatch: RegExp
  use?: Record<string, unknown>
}

export interface NardukPlaywrightPreset {
  fullyParallel: true
  projects: NardukPlaywrightProject[]
  use?: { baseURL: string }
  workers: 2
}

export interface NardukPlaywrightPresetOptions {
  /**
   * Scan these paths (or {@link testDir}) for undeclared specs. Default true
   * when `testDir` or `specFiles` is provided.
   */
  assertSpecTiers?: boolean
  /**
   * `http://127.0.0.1:${resolvedPort}` from the shipped dev-port helper.
   * The preset never invents port 3000.
   */
  baseURL?: string
  /**
   * Spread into each project's `use`. Pass `devices['Desktop Chrome']` from
   * the app's `@playwright/test` import.
   */
  browserUse?: Record<string, unknown>
  /**
   * Register a `chromium` project that collects the same specs as `web`. Off
   * by default: a bare `playwright test` would otherwise run every `.web` /
   * `.pr-web` spec twice. Pass `true` so `--project=chromium` still runs the
   * web tier.
   */
  chromiumAlias?: boolean
  /**
   * Register a `quarantine` project that collects `@quarantine` specs.
   * Default true. `pr` / `web` always `grepInvert` the tag so a tagged
   * spec is excluded from the PR project even when this is false.
   */
  quarantineProject?: boolean
  prViewports?: readonly string[]
  /**
   * Extra paths to assert. When `testDir` is also set, the disk scan is
   * unioned in so an explicit list cannot hide an undeclared file still
   * under `testDir`.
   */
  specFiles?: readonly string[]
  testDir?: string
  webViewports?: readonly string[]
}

export function classifyE2eFile(filePath: string): E2eFileClass | undefined {
  const normalized = filePath.replaceAll('\\', '/')
  if (SETUP_TEST_MATCH.test(normalized)) return 'setup'
  if (/\.pr-web\.spec\.[cm]?[jt]sx?$/.test(normalized)) return 'pr-web'
  if (/\.pr\.spec\.[cm]?[jt]sx?$/.test(normalized)) return 'pr'
  if (/\.web\.spec\.[cm]?[jt]sx?$/.test(normalized)) return 'web'
  if (/\.spec\.[cm]?[jt]sx?$/.test(normalized)) return 'undeclared'
  return undefined
}

export function specMatchesProject(
  filePath: string,
  projectName: string,
  options: { quarantined?: boolean } = {},
): boolean {
  const klass = classifyE2eFile(filePath)
  if (klass === undefined || klass === 'undeclared') return false
  if (projectName === SETUP_PROJECT_NAME) return klass === 'setup'
  if (isQuarantineProjectName(projectName)) {
    return options.quarantined === true && (klass === 'pr' || klass === 'web' || klass === 'pr-web')
  }
  if (options.quarantined === true) return false
  if (projectName === PR_PROJECT_NAME) return klass === 'pr' || klass === 'pr-web'
  if (projectName === WEB_PROJECT_NAME || projectName === CHROMIUM_PROJECT_ALIAS) {
    return klass === 'web' || klass === 'pr-web'
  }
  return false
}

export function collectSpecsForProject(
  filePaths: readonly string[],
  projectName: string,
  options: { quarantinedFiles?: ReadonlySet<string> } = {},
): string[] {
  return filePaths.filter((filePath) =>
    specMatchesProject(filePath, projectName, {
      quarantined: options.quarantinedFiles?.has(filePath) === true,
    }),
  )
}

export function listE2eFiles(testDir: string): string[] {
  const files: string[] = []

  const walk = (dir: string) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else files.push(full)
    }
  }

  walk(testDir)
  return files.filter((filePath) => classifyE2eFile(filePath) !== undefined)
}

export function assertE2eSpecTiers(filePaths: readonly string[]): void {
  const undeclared = filePaths.filter((filePath) => classifyE2eFile(filePath) === 'undeclared')
  if (undeclared.length === 0) return

  throw new Error(
    'E2E specs must declare a tier in the filename: `.pr.spec.ts`, `.web.spec.ts`, ' +
      'or `.pr-web.spec.ts` for both. An undeclared spec is collected by every ' +
      'project (narduk-libs#434):\n' +
      undeclared.map((filePath) => `  ${filePath}`).join('\n'),
  )
}

export function projectNameFromArgv(argv: readonly string[] = process.argv): string | undefined {
  const names: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--project' || arg === '-p') {
      const next = argv[index + 1]
      if (next) names.push(next)
      continue
    }
    if (arg.startsWith('--project=')) names.push(arg.slice('--project='.length))
  }
  return names.length === 1 ? names[0] : undefined
}

export function viewportsAtCollection<T extends { name: string }>(
  all: readonly T[],
  project:
    | string
    | {
        metadata?: { visualAuditViewports?: readonly string[] }
        name?: string
      },
): T[] {
  const metadata = typeof project === 'string' ? undefined : project.metadata
  const name = typeof project === 'string' ? project : project.name
  const allowed = metadata?.visualAuditViewports ?? viewportsForProjectName(name)
  if (!allowed) return [...all]
  const allowedSet = new Set(allowed)
  return all.filter((viewport) => allowedSet.has(viewport.name))
}

function viewportsForProjectName(name: string | undefined): readonly string[] | undefined {
  if (name === PR_PROJECT_NAME) return DEFAULT_PR_VIEWPORT_NAMES
  if (name === WEB_PROJECT_NAME || name === CHROMIUM_PROJECT_ALIAS) {
    return DEFAULT_WEB_VIEWPORT_NAMES
  }
  return undefined
}

function filesForTierAssertion(options: NardukPlaywrightPresetOptions): string[] {
  const fromDir = options.testDir ? listE2eFiles(options.testDir) : []
  if (options.specFiles === undefined) return fromDir
  if (fromDir.length === 0) return [...options.specFiles]

  const seen = new Set(fromDir)
  const files = [...fromDir]
  for (const file of options.specFiles) {
    if (seen.has(file)) continue
    seen.add(file)
    files.push(file)
  }
  return files
}

export function createNardukPlaywrightPreset(
  options: NardukPlaywrightPresetOptions = {},
): NardukPlaywrightPreset {
  const chromiumAlias = options.chromiumAlias === true
  const quarantineProject = options.quarantineProject !== false
  const prViewports = options.prViewports ?? DEFAULT_PR_VIEWPORT_NAMES
  const webViewports = options.webViewports ?? DEFAULT_WEB_VIEWPORT_NAMES
  const browserUse = options.browserUse ?? { browserName: 'chromium' }

  const shouldAssert =
    options.assertSpecTiers !== false &&
    (options.specFiles !== undefined || options.testDir !== undefined)
  if (shouldAssert) {
    assertE2eSpecTiers(filesForTierAssertion(options))
  }

  const pr: NardukPlaywrightProject = {
    name: PR_PROJECT_NAME,
    testMatch: PR_TEST_MATCH,
    testIgnore: SETUP_TEST_MATCH,
    grepInvert: QUARANTINE_GREP,
    dependencies: [SETUP_PROJECT_NAME],
    use: { ...browserUse },
    metadata: { e2eTier: 'pr', visualAuditViewports: [...prViewports] },
  }
  const web: NardukPlaywrightProject = {
    name: WEB_PROJECT_NAME,
    testMatch: WEB_TEST_MATCH,
    testIgnore: SETUP_TEST_MATCH,
    grepInvert: QUARANTINE_GREP,
    dependencies: [SETUP_PROJECT_NAME],
    use: { ...browserUse },
    metadata: { e2eTier: 'web', visualAuditViewports: [...webViewports] },
  }

  const projects: NardukPlaywrightProject[] = [
    {
      name: SETUP_PROJECT_NAME,
      testMatch: SETUP_TEST_MATCH,
      use: { ...browserUse },
      metadata: { e2eTier: 'setup', visualAuditViewports: [] },
    },
    pr,
    web,
  ]

  if (chromiumAlias) {
    projects.push({
      ...web,
      name: CHROMIUM_PROJECT_ALIAS,
      metadata: { e2eTier: 'web', visualAuditViewports: [...webViewports] },
    })
  }

  if (quarantineProject) {
    projects.push({
      name: QUARANTINE_PROJECT_NAME,
      testMatch: QUARANTINE_TEST_MATCH,
      testIgnore: SETUP_TEST_MATCH,
      grep: QUARANTINE_GREP,
      dependencies: [SETUP_PROJECT_NAME],
      use: { ...browserUse },
      metadata: { e2eTier: 'quarantine', visualAuditViewports: [...webViewports] },
    })
  }

  const preset: NardukPlaywrightPreset = {
    fullyParallel: NARDUK_PLAYWRIGHT_FULLY_PARALLEL,
    workers: NARDUK_PLAYWRIGHT_WORKERS,
    projects,
  }

  if (options.baseURL !== undefined) {
    preset.use = { baseURL: options.baseURL }
  }

  return preset
}
