/**
 * The two small app-local scripts every template-derived app carried as a copy
 * (narduk-libs#1019): `scripts/ensure-generated-files.sh` and
 * `scripts/check-starter-identity.mjs`. They ship here as
 * `narduk-app ensure-generated` and `narduk-app check-starter-identity`, with
 * the same rules, so an app can delete its copies.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const GENERATED_FILE_ATTEMPTS = 5
const GENERATED_FILE_RETRY_MS = 1000
const PNPM_STORE_IMPORT_PATTERNS = [
  /from\s+['"]([^'"]*node_modules\/\.pnpm\/[^'"]*)['"]/gu,
  /^import\s+['"]([^'"]*node_modules\/\.pnpm\/[^'"]*)['"]/gmu,
]

export interface EnsureGeneratedArgs {
  targets: string[]
  command: string[]
}

export const ENSURE_GENERATED_USAGE =
  'Usage: narduk-app ensure-generated <generated-file> [<generated-file> ...] -- <command> [args...]'

export function parseEnsureGeneratedArgs(args: readonly string[]): EnsureGeneratedArgs {
  const separator = args.indexOf('--')
  if (separator < 1 || separator === args.length - 1) throw new Error(ENSURE_GENERATED_USAGE)
  return { targets: args.slice(0, separator), command: args.slice(separator + 1) }
}

/**
 * A generated file is current when it exists and every `node_modules/.pnpm/...`
 * path it imports still resolves from its directory. A reinstall that moved the
 * pnpm store entry leaves a `.nuxt/*.d.ts` pointing at a path that is gone,
 * which reads as present but is stale.
 */
export function isGeneratedFileCurrent(target: string): boolean {
  if (!existsSync(target)) return false
  let content: string
  try {
    if (!statSync(target).isFile()) return false
    content = readFileSync(target, 'utf8')
  } catch {
    return false
  }
  const targetDir = dirname(target)
  for (const pattern of PNPM_STORE_IMPORT_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      const importPath = match[1]
      if (importPath && !existsSync(resolve(targetDir, importPath))) return false
    }
  }
  return true
}

export interface EnsureGeneratedDeps {
  cwd?: string
  isCurrent?: (target: string) => boolean
  run?: (command: string[], cwd: string) => number
  sleep?: (ms: number) => void
  log?: (line: string) => void
}

function runInherited(command: string[], cwd: string): number {
  const [file, ...args] = command
  if (!file) return 1
  const result = spawnSync(file, args, { cwd, stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  return result.status ?? 1
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Run `command` only when a target is missing or stale, then wait up to five
 * seconds for every target to become current. The command's own non-zero exit
 * is returned as is, like the shell script under `set -e`.
 */
export function runEnsureGenerated(
  args: EnsureGeneratedArgs,
  deps: EnsureGeneratedDeps = {},
): number {
  const cwd = deps.cwd ?? process.cwd()
  const isCurrent = deps.isCurrent ?? isGeneratedFileCurrent
  const run = deps.run ?? runInherited
  const sleep = deps.sleep ?? sleepSync
  const log = deps.log ?? ((line: string) => console.error(line))
  const targets = args.targets.map((target) => resolve(cwd, target))
  const allCurrent = () => targets.every((target) => isCurrent(target))

  if (allCurrent()) return 0
  const status = run(args.command, cwd)
  if (status !== 0) return status

  for (let attempt = 1; !allCurrent(); attempt += 1) {
    if (attempt >= GENERATED_FILE_ATTEMPTS) {
      log(`Expected generated file(s) missing or stale after: ${args.command.join(' ')}`)
      for (const [index, target] of targets.entries()) {
        if (!isCurrent(target)) log(`Missing or stale: ${args.targets[index]}`)
      }
      return 1
    }
    sleep(GENERATED_FILE_RETRY_MS)
  }
  return 0
}

/** The generator placeholders a real app must not still carry. */
export const STARTER_IDENTITY_PLACEHOLDERS = [
  'APP_NAME',
  'DISPLAY_NAME',
  'SITE_URL',
  'APP_DESCRIPTION',
  'SPEC_PROBLEM',
  'SPEC_USERS',
  'SPEC_MVP_BULLETS',
  'SPEC_NON_GOALS',
].map((key) => `__${key}__`)

const STARTER_IDENTITY_IGNORED_DIRS = new Set([
  '.git',
  '.nuxt',
  '.output',
  '.turbo',
  '.wrangler',
  'dist',
  'node_modules',
])
const STARTER_IDENTITY_IGNORED_FILES = new Set(['pnpm-lock.yaml'])
const STARTER_IDENTITY_SURFACE =
  /(?:^|\/)(?:README\.md|SPEC\.md|UI_PLAN\.md|CONTRACT\.md|package\.json|wrangler\.json|site\.webmanifest)$|^apps\/web\/app\/(?:app\.config\.ts|pages\/.*\.vue|layouts\/.*\.vue)$/iu

function isDirectoryEntry(absolutePath: string, isDirectory: boolean, isLink: boolean): boolean {
  if (isDirectory || !isLink) return isDirectory
  try {
    return statSync(absolutePath).isDirectory()
  } catch {
    return false
  }
}

function collectIdentitySurfaces(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (STARTER_IDENTITY_IGNORED_DIRS.has(entry.name)) continue
    const absolutePath = join(dir, entry.name)
    if (isDirectoryEntry(absolutePath, entry.isDirectory(), entry.isSymbolicLink())) {
      collectIdentitySurfaces(root, absolutePath, out)
      continue
    }
    const relativePath = relative(root, absolutePath).split(sep).join('/')
    const basename = relativePath.slice(relativePath.lastIndexOf('/') + 1)
    if (
      !STARTER_IDENTITY_IGNORED_FILES.has(basename) &&
      STARTER_IDENTITY_SURFACE.test(relativePath)
    ) {
      out.push(relativePath)
    }
  }
}

/** `<file>: <placeholder>` for every starter placeholder left on an identity surface. */
export function findStarterIdentityPlaceholders(root: string): string[] {
  const files: string[] = []
  collectIdentitySurfaces(root, root, files)
  const hits: string[] = []
  for (const file of files.sort()) {
    let content: string
    try {
      content = readFileSync(join(root, file), 'utf8')
    } catch {
      continue
    }
    for (const placeholder of STARTER_IDENTITY_PLACEHOLDERS) {
      if (content.includes(placeholder)) hits.push(`${file}: ${placeholder}`)
    }
  }
  return hits
}

export function parseStarterIdentityArgs(args: readonly string[], cwd = process.cwd()): string {
  let root = cwd
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--cwd') {
      const value = args[(index += 1)]
      if (!value) throw new Error('--cwd requires a directory')
      root = value
    } else {
      throw new Error(`Unknown check-starter-identity option: ${arg}`)
    }
  }
  return resolve(cwd, root)
}

export function runStarterIdentityCheck(
  root: string,
  log: (text: string) => void = (text) => console.error(text),
): number {
  const hits = findStarterIdentityPlaceholders(root)
  if (hits.length === 0) return 0
  log(
    [
      '[starter-identity] Starter identity placeholders remain in this app.',
      'Replace the app slug, display name, site URL, description, and spec placeholders before final validation.',
      '',
      ...hits.map((hit) => `- ${hit}`),
    ].join('\n'),
  )
  return 1
}
