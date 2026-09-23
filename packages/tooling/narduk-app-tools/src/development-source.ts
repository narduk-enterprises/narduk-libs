import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { declarationDigest, privateDirectory, writePrivateJson } from './development-state.js'

export interface SourceEntry {
  path: string
  kind: 'file' | 'symlink' | 'deleted'
  mode: number
  digest?: string
  size?: number
  link?: string
}
export interface SourceSnapshot {
  schemaVersion: 1
  directory: string
  baseCommit: string
  digest: string
  entries: SourceEntry[]
}
const excludedDirectories = new Set([
  '.git',
  'node_modules',
  '.nuxt',
  '.output',
  '.wrangler',
  '.cache',
  '.turbo',
  '.pnpm-store',
  '.codegraph',
  '.cursor',
  'coverage',
  'test-results',
  'playwright-report',
])
/** The build workspace's own branch; it has no remote and is never pushed. */
const workspaceBranch = 'narduk-development-workspace'
/**
 * Publisher-owned build state the workspace keeps between deploys. It survives
 * pruning and, because it is not captured source, it is excluded from the
 * workspace repository too -- otherwise a warm dependency tree would be listed
 * by a gate enumerating with `git ls-files -co` whenever the app's own ignore
 * rules happen not to cover it.
 */
const workspacePreserved = ['node_modules']
export function excludedSourcePath(path: string): boolean {
  const parts = path.split('/')
  const name = parts.at(-1) ?? ''
  return (
    parts.some((part) => excludedDirectories.has(part)) ||
    /^\.(?:env(?:\..*)?|dev\.vars(?:\..*)?|npmrc\.auth|netrc|npmrc\.token)$/u.test(name) ||
    /\.(?:pem|p12|pfx|key)$/iu.test(name) ||
    /^id_(?:rsa|ed25519|ecdsa)(?:\.pub)?$/u.test(name)
  )
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}
function safePath(root: string, path: string): string {
  if (!path || isAbsolute(path) || path.split('/').includes('..') || path.includes('\0'))
    throw new Error(`Unsafe source path: ${path}`)
  const absolute = resolve(root, path)
  if (!inside(root, absolute)) throw new Error(`Source escapes capture boundary: ${path}`)
  return absolute
}
function git(root: string, args: string[]): string {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  }
  return execFileSync('git', args, {
    cwd: root,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}
function listSource(root: string, additional: string[]): string[] {
  const staged = git(root, ['ls-files', '--stage', '-z']).split('\0')
  if (staged.some((entry) => entry.startsWith('160000 ')))
    throw new Error(
      'Submodules are not supported by local source capture; resolve them before enrollment',
    )
  if (staged.some((entry) => /^\d+ [a-f0-9]+ [123]\t/u.test(entry)))
    throw new Error('Resolve merge conflicts before capturing source')
  const files = new Set(
    git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
      .split('\0')
      .filter(Boolean),
  )
  const add = (path: string): void => {
    if (excludedSourcePath(path))
      throw new Error(`Additional input is excluded from capture: ${path}`)
    const absolute = safePath(root, path)
    const stat = lstatSync(absolute)
    if (stat.isDirectory()) {
      for (const child of readdirSync(absolute).sort()) add(`${path}/${child}`)
    } else files.add(path)
  }
  for (const path of additional) add(path)
  return [...files].filter((path) => !excludedSourcePath(path)).sort()
}
function scan(
  root: string,
  additional: string[],
  destination?: string,
): { baseCommit: string; entries: SourceEntry[] } {
  const baseCommit = git(root, ['rev-parse', 'HEAD']).trim()
  const paths = listSource(root, additional)
  const entries: SourceEntry[] = []
  for (const path of paths) {
    const absolute = safePath(root, path)
    let stat
    try {
      stat = lstatSync(absolute)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      entries.push({ path, kind: 'deleted', mode: 0 })
      continue
    }
    const actual = realpathSync(absolute)
    if (!inside(root, actual) || excludedSourcePath(relative(root, actual).split(sep).join('/')))
      throw new Error(`Source link escapes or points at excluded input: ${path}`)
    const mode = stat.mode & 0o777
    const output = destination ? safePath(destination, path) : undefined
    if (output) mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
    if (stat.isSymbolicLink()) {
      const link = readlinkSync(absolute)
      if (isAbsolute(link)) throw new Error(`Absolute source symlinks are not portable: ${path}`)
      const targetPath = relative(root, actual).split(sep).join('/')
      if (
        targetPath &&
        !paths.some(
          (candidate) => candidate === targetPath || candidate.startsWith(`${targetPath}/`),
        )
      )
        throw new Error(`Symlink target is not captured: ${path}`)
      entries.push({ path, kind: 'symlink', mode, link })
      if (output) symlinkSync(link, output)
    } else if (stat.isFile()) {
      const bytes = readFileSync(absolute)
      if (
        path.endsWith('.npmrc') &&
        /(?:_authToken|_auth|_password)\s*=\s*(?!\$\{)[^\s#;]+/u.test(bytes.toString('utf8'))
      )
        throw new Error(`Inline registry credentials cannot enter a source snapshot: ${path}`)
      entries.push({
        path,
        kind: 'file',
        mode,
        size: bytes.length,
        digest: createHash('sha256').update(bytes).digest('hex'),
      })
      if (output) {
        writeFileSync(output, bytes, { flag: 'wx', mode })
        chmodSync(output, mode)
      }
    } else throw new Error(`Unsupported source file type: ${path}`)
  }
  return { baseCommit, entries }
}

/** Two independent full manifests detect concurrent edits, including new/deleted files. */
export function captureDevelopmentSource(
  checkout: string,
  snapshotDirectory: string,
  options: { additional?: string[]; attempts?: number; afterCopy?: () => void } = {},
): SourceSnapshot {
  const root = realpathSync(checkout)
  if (inside(root, resolve(snapshotDirectory)))
    throw new Error('Snapshots must live outside the authoring checkout')
  if (existsSync(snapshotDirectory)) throw new Error('A snapshot destination must be new')
  const additional = options.additional ?? []
  for (let attempt = 0; attempt < (options.attempts ?? 3); attempt++) {
    privateDirectory(snapshotDirectory)
    try {
      const first = scan(root, additional, snapshotDirectory)
      options.afterCopy?.()
      const second = scan(root, additional)
      if (declarationDigest(first) === declarationDigest(second)) {
        const snapshot: SourceSnapshot = {
          schemaVersion: 1,
          directory: snapshotDirectory,
          ...first,
          digest: declarationDigest(first),
        }
        return snapshot
      }
    } catch (error) {
      rmSync(snapshotDirectory, { recursive: true, force: true })
      throw error
    }
    rmSync(snapshotDirectory, { recursive: true, force: true })
  }
  throw new Error('Source kept changing during capture; pause edits briefly and retry')
}

/** Rebuild the source tree while retaining only publisher-owned installed dependencies. */
export function populateDevelopmentWorkspace(snapshot: SourceSnapshot, workspace: string): void {
  if (
    inside(resolve(snapshot.directory), resolve(workspace)) ||
    inside(resolve(workspace), resolve(snapshot.directory))
  )
    throw new Error('Snapshot and build workspace must be separate')
  privateDirectory(workspace)
  const prune = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      // Publisher-owned build state: installed dependencies and the workspace's
      // own repository. Both are rebuilt incrementally, which is what keeps the
      // loop cheap; neither is ever part of the captured source.
      if (name === '.git' || workspacePreserved.includes(name)) continue
      const path = join(directory, name)
      const stat = lstatSync(path)
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        prune(path)
        if (readdirSync(path).length === 0) rmSync(path, { recursive: true })
      } else rmSync(path)
    }
  }
  prune(workspace)
  // Files first, links second, so copies never follow a captured link.
  for (const entry of [...snapshot.entries].sort(
    (a, b) => Number(a.kind === 'symlink') - Number(b.kind === 'symlink'),
  )) {
    if (entry.kind === 'deleted') continue
    const path = safePath(workspace, entry.path)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    if (entry.kind === 'file') {
      copyFileSync(safePath(snapshot.directory, entry.path), path)
      chmodSync(path, entry.mode)
    } else symlinkSync(entry.link!, path)
  }
  initializeWorkspaceRepository(snapshot, workspace)
  assertCapturedInputs(snapshot, workspace)
}

/**
 * Apps gate with repository-shaped commands -- `git rev-parse --show-toplevel`
 * to find the root, `git ls-files -co --exclude-standard` to enumerate what a
 * sensitive scan must read. The build workspace is a private copy rather than a
 * checkout, so without a repository of its own those checks die with "fatal:
 * not a git repository" and refuse the deploy before it ever builds. Committing
 * the captured tree answers all three shapes -- toplevel, tracked and
 * untracked, and a clean `git status` -- against exactly the source that was
 * captured, with no network remote and no branch to push. The repository is
 * kept between deploys, so this costs one incremental commit per iteration.
 *
 * The publisher's own git configuration is excluded deliberately: identity,
 * signing, hooks and init templates from the authoring machine must not run
 * against a build tree.
 */
function initializeWorkspaceRepository(snapshot: SourceSnapshot, workspace: string): void {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  }
  const run = (...args: string[]): void => {
    execFileSync('git', args, { cwd: workspace, env, stdio: 'ignore' })
  }
  run('init', '--quiet', '--template=', '--initial-branch', workspaceBranch)
  // Not the app's `.gitignore`, which may or may not cover its own dependency
  // directories: the capture boundary itself, stated where no app rule can
  // weaken it.
  mkdirSync(join(workspace, '.git', 'info'), { recursive: true, mode: 0o700 })
  writeFileSync(
    join(workspace, '.git', 'info', 'exclude'),
    `${workspacePreserved.map((name) => `${name}/`).join('\n')}\n`,
    { mode: 0o600 },
  )
  run('add', '--all')
  run(
    '-c',
    'user.name=narduk-app development',
    '-c',
    'user.email=development@narduk.invalid',
    'commit',
    '--quiet',
    '--allow-empty',
    '--no-verify',
    '--no-gpg-sign',
    '--message',
    `captured source ${snapshot.digest} from ${snapshot.baseCommit}`,
  )
}

export function assertCapturedInputs(snapshot: SourceSnapshot, workspace: string): void {
  for (const entry of snapshot.entries) {
    const path = safePath(workspace, entry.path)
    if (entry.kind === 'deleted') {
      if (existsSync(path))
        throw new Error(`Deleted source was recreated by checks/build: ${entry.path}`)
      continue
    }
    const stat = lstatSync(path)
    const valid =
      entry.kind === 'symlink'
        ? stat.isSymbolicLink() && readlinkSync(path) === entry.link
        : stat.isFile() &&
          !stat.isSymbolicLink() &&
          (stat.mode & 0o777) === entry.mode &&
          createHash('sha256').update(readFileSync(path)).digest('hex') === entry.digest
    if (!valid) throw new Error(`Captured source changed during checks/build: ${entry.path}`)
  }
}

export function dependencyFingerprint(
  snapshot: SourceSnapshot,
  packageManagerVersion: string,
): string {
  const inputs = snapshot.entries.filter((entry) =>
    /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|pnpm-workspace\.yaml|\.npmrc|\.pnpmfile\.cjs|\.node-version|\.nvmrc|\.tool-versions)$/u.test(
      entry.path,
    ),
  )
  return declarationDigest({
    inputs,
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    packageManagerVersion,
  })
}

export function newDevelopmentBuildId(): string {
  return `dev-${new Date().toISOString().replaceAll(/[-:.]/gu, '')}-${randomUUID().slice(0, 8)}`
}

export function retainSourceManifest(snapshot: SourceSnapshot, receiptDirectory: string): void {
  writePrivateJson(join(receiptDirectory, 'source-manifest.json'), snapshot)
}
