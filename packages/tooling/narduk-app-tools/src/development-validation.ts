/**
 * Full CI after every verified deploy, without waiting for it (O-D4).
 *
 * deploy:dev queues the deployed commit and returns. A detached worker pushes
 * it to `narduk-validation/<sha>/<uuid>`, which alone triggers the app's
 * validation workflow, and cancels the still-running validation of any older
 * automatic request for the same target. At most one worker runs per
 * repository on a host; a newer queued commit replaces an older one that has
 * not been pushed yet, so the newest deployed SHA always wins.
 *
 * The worker never writes the activation record: deploys hold the target lock
 * and own it. Its own state lives beside it under `validation/`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { DevelopmentGitHub } from './development-github.js'
import { developmentSystemEnv } from './development-process.js'
import { repositoryKey } from './development-records.js'
import type { SourceSnapshot } from './development-source.js'
import { privateDirectory, readPrivateJson, writePrivateJson } from './development-state.js'

export interface DeployedValidationRequest {
  repository: string
  checkout: string
  sha: string
  buildId: string
  reason: string
  /** The deploy passed --gated: protected paths changed. */
  gated: boolean
  queuedAt: string
}

export interface ValidationHistoryEntry {
  sha: string
  buildId: string
  validationRef: string
  requestedAt: string
  gated: boolean
  supersededAt?: string
  cancelledRuns?: number[]
}

export type ValidationGitHubClient = Pick<
  DevelopmentGitHub,
  'requestDeployedValidation' | 'activeValidationRuns' | 'cancelRun'
>

const HISTORY_LIMIT = 20
const WORKER_ROUNDS = 25
const STARTING_GRACE_MS = 60_000

export function validationDirectory(stateDirectory: string, repository: string): string {
  return join(stateDirectory, 'validation', repositoryKey(repository))
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// ─── the deployed commit ──────────────────────────────────────────────────────

function gitPlumbing(
  checkout: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  input?: string,
  allowed: number[] = [0],
): string {
  const result = spawnSync('git', args, {
    cwd: checkout,
    env,
    input,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.error || result.signal || !allowed.includes(result.status ?? -1))
    throw new Error(`git ${args[0]} failed while recording the deployed tree`)
  return result.stdout
}

function blobId(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

/**
 * The commit a deploy served. A clean capture is its base commit. A dirty one
 * becomes a commit whose parent is the base commit and whose tree is exactly
 * what `git add -A` would have staged from the capture: tracked edits and
 * deletions plus unignored untracked files. Ignored additional build inputs
 * never leave the host. Plumbing only: no hooks, filters, signing or identity
 * from the authoring machine. A local ref keeps it reachable until pushed.
 */
export function recordDeployedCommit(
  checkout: string,
  snapshot: SourceSnapshot,
  buildId: string,
  dirty: boolean,
): string {
  if (!dirty) return snapshot.baseCommit
  const index = join(snapshot.directory, '..', `${buildId}.validation-index`)
  const env: NodeJS.ProcessEnv = {
    ...developmentSystemEnv(),
    GIT_INDEX_FILE: index,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'narduk-app development',
    GIT_AUTHOR_EMAIL: 'development@narduk.invalid',
    GIT_COMMITTER_NAME: 'narduk-app development',
    GIT_COMMITTER_EMAIL: 'development@narduk.invalid',
  }
  try {
    const base = new Map<string, { mode: string; id: string }>()
    for (const line of gitPlumbing(checkout, ['ls-tree', '-r', '-z', snapshot.baseCommit], env)
      .split('\0')
      .filter(Boolean)) {
      const match = /^(\d+) \w+ ([a-f0-9]+)\t(.+)$/su.exec(line)
      if (match) base.set(match[3], { mode: match[1], id: match[2] })
    }
    const candidates = snapshot.entries.filter(
      (entry) => entry.kind !== 'deleted' && !base.has(entry.path),
    )
    const ignored = new Set(
      candidates.length
        ? gitPlumbing(
            checkout,
            ['check-ignore', '--stdin', '-z'],
            env,
            candidates.map((entry) => `${entry.path}\0`).join(''),
            [0, 1],
          )
            .split('\0')
            .filter(Boolean)
        : [],
    )
    const updates: string[] = []
    const files: Array<{ mode: string; path: string }> = []
    for (const entry of snapshot.entries) {
      if (entry.kind === 'deleted') {
        if (base.has(entry.path)) updates.push(`0 ${'0'.repeat(40)}\t${entry.path}`)
        continue
      }
      if (ignored.has(entry.path)) continue
      const bytes =
        entry.kind === 'symlink'
          ? Buffer.from(entry.link ?? '')
          : readFileSync(join(snapshot.directory, entry.path))
      const mode = entry.kind === 'symlink' ? '120000' : entry.mode & 0o111 ? '100755' : '100644'
      const known = base.get(entry.path)
      if (known && known.id === blobId(bytes) && known.mode === mode) continue
      // Links (and paths --stdin-paths cannot carry) are rare and written one by
      // one; ordinary files are written in one batch.
      if (entry.kind === 'symlink' || entry.path.includes('\n'))
        updates.push(`${mode} ${writeBlob(checkout, env, bytes)}\t${entry.path}`)
      else files.push({ mode, path: entry.path })
    }
    if (files.length) {
      const ids = gitPlumbing(
        checkout,
        ['hash-object', '-w', '--no-filters', '--stdin-paths'],
        env,
        files.map((file) => `${join(snapshot.directory, file.path)}\n`).join(''),
      )
        .split('\n')
        .filter(Boolean)
      if (ids.length !== files.length) throw new Error('git hash-object returned a partial batch')
      for (const [index, file] of files.entries())
        updates.push(`${file.mode} ${ids[index]}\t${file.path}`)
    }
    if (!updates.length) return snapshot.baseCommit
    gitPlumbing(checkout, ['read-tree', snapshot.baseCommit], env)
    gitPlumbing(checkout, ['update-index', '-z', '--index-info'], env, `${updates.join('\0')}\0`)
    const tree = gitPlumbing(checkout, ['write-tree'], env).trim()
    const commit = gitPlumbing(
      checkout,
      [
        'commit-tree',
        tree,
        '-p',
        snapshot.baseCommit,
        '--no-gpg-sign',
        '-m',
        `narduk-app development: deployed tree of ${buildId}`,
      ],
      env,
    ).trim()
    gitPlumbing(checkout, ['update-ref', 'refs/narduk/development/validation', commit], env)
    return commit
  } finally {
    rmSync(index, { force: true })
  }
}

function writeBlob(checkout: string, env: NodeJS.ProcessEnv, bytes: Buffer): string {
  const result = spawnSync('git', ['hash-object', '-w', '--no-filters', '--stdin'], {
    cwd: checkout,
    env,
    input: bytes,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.error || result.signal || result.status !== 0)
    throw new Error('git hash-object failed while recording the deployed tree')
  return result.stdout.toString('utf8').trim()
}

// ─── queue and worker ─────────────────────────────────────────────────────────

/** Replace any older queued request: the newest deployed SHA wins. */
export function enqueueDeployedValidation(
  request: DeployedValidationRequest,
  stateDirectory: string,
): void {
  writePrivateJson(
    join(validationDirectory(stateDirectory, request.repository), 'queue.json'),
    request,
  )
}

interface WorkerLock {
  pid: number
  workstation: string
  startedAt: string
}

function lockPath(directory: string): string {
  return join(directory, 'worker.lock')
}

/** Start a detached worker unless a live one already drains this repository's queue. */
export function startValidationWorker(
  request: DeployedValidationRequest,
  stateDirectory: string,
  env: NodeJS.ProcessEnv,
): 'started' | 'running' {
  const directory = validationDirectory(stateDirectory, request.repository)
  const owner = join(lockPath(directory), 'owner.json')
  if (existsSync(owner)) {
    const lock = readPrivateJson(owner) as WorkerLock
    if (lock.workstation === hostname() && processAlive(lock.pid)) return 'running'
  }
  privateDirectory(directory)
  const log = openSync(join(directory, 'worker.log'), 'a', 0o600)
  try {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./bin.js', import.meta.url)), 'development', 'validation-worker'],
      { cwd: request.checkout, env, detached: true, stdio: ['ignore', log, log] },
    )
    child.unref()
  } finally {
    closeSync(log)
  }
  return 'started'
}

function acquireWorker(directory: string): (() => void) | undefined {
  privateDirectory(directory)
  const path = lockPath(directory)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(path, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const owner = join(path, 'owner.json')
      const lock = existsSync(owner) ? (readPrivateJson(owner) as WorkerLock) : undefined
      // A live worker drains whatever was queued; a dead one's lock is reclaimed
      // once. A lock with no owner yet is another worker starting, unless it is
      // older than any start could take.
      const starting = !lock && Date.now() - statSync(path).mtimeMs < STARTING_GRACE_MS
      if (starting || (lock && lock.workstation === hostname() && processAlive(lock.pid)))
        return undefined
      rmSync(path, { recursive: true, force: true })
      continue
    }
    writePrivateJson(join(path, 'owner.json'), {
      pid: process.pid,
      workstation: hostname(),
      startedAt: new Date().toISOString(),
    } satisfies WorkerLock)
    return () => rmSync(path, { recursive: true, force: true })
  }
  return undefined
}

export function readValidationHistory(
  stateDirectory: string,
  repository: string,
): ValidationHistoryEntry[] {
  const path = join(validationDirectory(stateDirectory, repository), 'history.json')
  return existsSync(path) ? (readPrivateJson(path) as ValidationHistoryEntry[]) : []
}

/**
 * Drain the queue: push the newest request, then cancel the unfinished runs of
 * every older automatic request it supersedes. Explicit `development validate`
 * requests are never touched. Returns the refs it pushed.
 */
export function drainDeployedValidations(args: {
  repository: string
  stateDirectory: string
  github: ValidationGitHubClient
  log: (message: string) => void
}): string[] {
  const directory = validationDirectory(args.stateDirectory, args.repository)
  const queue = join(directory, 'queue.json')
  const pushed: string[] = []
  // A request queued while this worker releases its lock would see the lock
  // as live and start nobody; look once more after releasing.
  for (let pass = 0; pass < 3; pass += 1) {
    const release = acquireWorker(directory)
    if (!release) {
      if (pass === 0) args.log('[validation] another worker is draining this queue')
      return pushed
    }
    try {
      drainOnce(directory, queue, args, pushed)
    } finally {
      release()
    }
    if (!existsSync(queue)) break
  }
  return pushed
}

function drainOnce(
  directory: string,
  queue: string,
  args: {
    repository: string
    stateDirectory: string
    github: ValidationGitHubClient
    log: (message: string) => void
  },
  pushed: string[],
): void {
  for (let round = 0; round < WORKER_ROUNDS; round += 1) {
    if (!existsSync(queue)) break
    const taking = join(directory, 'taking.json')
    renameSync(queue, taking)
    const request = readPrivateJson(taking) as DeployedValidationRequest
    rmSync(taking, { force: true })
    const history = readValidationHistory(args.stateDirectory, args.repository)
    let validationRef: string
    try {
      validationRef = args.github.requestDeployedValidation(request.checkout, request.sha)
    } catch (error) {
      args.log(
        `[validation] ${request.buildId} ${request.sha}: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }
    pushed.push(validationRef)
    args.log(
      `[validation] ${request.buildId}: full validation of ${request.sha} via ${validationRef}`,
    )
    const now = new Date().toISOString()
    for (const older of history) {
      if (older.supersededAt) continue
      older.supersededAt = now
      try {
        older.cancelledRuns = args.github.activeValidationRuns(older.validationRef)
        for (const id of older.cancelledRuns) args.github.cancelRun(id)
        if (older.cancelledRuns.length)
          args.log(
            `[validation] superseded ${older.sha}: cancelled run(s) ${older.cancelledRuns.join(', ')}`,
          )
      } catch {
        args.log(`[validation] could not cancel runs of superseded ${older.validationRef}`)
      }
    }
    history.push({
      sha: request.sha,
      buildId: request.buildId,
      validationRef,
      requestedAt: now,
      gated: request.gated,
    })
    writePrivateJson(join(directory, 'history.json'), history.slice(-HISTORY_LIMIT))
  }
}
