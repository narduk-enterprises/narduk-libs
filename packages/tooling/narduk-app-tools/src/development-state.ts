import { randomUUID, createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

export interface DeploymentTarget {
  accountId: string
  workerName: string
}
export interface TargetLockRecord {
  schemaVersion: 1
  owner: string
  target: DeploymentTarget
  operation: string
  pid: number
  workstation: string
  startedAt: string
  receipt: string
}

export function developmentStateDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_STATE_HOME || join(env.HOME || homedir(), '.local', 'state')
  if (!isAbsolute(base)) throw new Error('XDG_STATE_HOME must be an absolute path')
  return join(base, 'narduk-app-tools', 'development')
}

export function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`Not a private directory: ${path}`)
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid())
    throw new Error(`Private state is owned by a different user: ${path}`)
  chmodSync(path, 0o700)
}

/** Write intent durably before any provider mutation. Never put secret values here. */
export function writePrivateJson(path: string, value: unknown): void {
  privateDirectory(dirname(path))
  const temporary = `${path}.${randomUUID()}.tmp`
  const descriptor = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  try {
    renameSync(temporary, path)
    const directory = openSync(dirname(path), 'r')
    try {
      fsyncSync(directory)
    } finally {
      closeSync(directory)
    }
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function readPrivateJson(path: string): unknown {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new Error(`State must be a private regular file: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

export function targetKey(target: DeploymentTarget): string {
  if (
    !/^[a-f0-9]{32}$/u.test(target.accountId) ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(target.workerName)
  )
    throw new Error('Invalid deployment target identity')
  return `${target.accountId}-${target.workerName}`
}

export function targetLockPath(target: DeploymentTarget, stateDirectory: string): string {
  return join(stateDirectory, 'locks', `${targetKey(target)}.lock`)
}

/** Cooperative host lock: clones and worktrees share account/Worker custody. */
export function acquireTargetLocks(
  targets: DeploymentTarget[],
  operation: string,
  receipt: string,
  stateDirectory = developmentStateDirectory(),
): { release: () => void; records: TargetLockRecord[] } {
  const ordered = [...targets].sort((a, b) => targetKey(a).localeCompare(targetKey(b)))
  if (new Set(ordered.map(targetKey)).size !== ordered.length)
    throw new Error('Duplicate target lock')
  privateDirectory(stateDirectory)
  privateDirectory(join(stateDirectory, 'locks'))
  const held: Array<{ path: string; record: TargetLockRecord }> = []
  const release = (): void => {
    for (const entry of [...held].reverse()) {
      const actual = readPrivateJson(join(entry.path, 'owner.json')) as TargetLockRecord
      if (actual.owner !== entry.record.owner)
        throw new Error(`Lock owner changed; inspect ${entry.path}`)
      rmSync(join(entry.path, 'owner.json'))
      rmdirSync(entry.path)
      held.splice(held.indexOf(entry), 1)
    }
  }
  try {
    for (const target of ordered) {
      const path = targetLockPath(target, stateDirectory)
      try {
        mkdirSync(path, { mode: 0o700 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        throw new Error(
          `Target is locked: ${path}. Inspect its process and provider state; age does not authorize reclamation.`,
        )
      }
      const record: TargetLockRecord = {
        schemaVersion: 1,
        owner: randomUUID(),
        target,
        operation,
        receipt,
        pid: process.pid,
        workstation: hostname(),
        startedAt: new Date().toISOString(),
      }
      // If metadata cannot be persisted, keep the visible incomplete lock for inspection.
      writePrivateJson(join(path, 'owner.json'), record)
      held.push({ path, record })
    }
    return { release, records: held.map((entry) => entry.record) }
  } catch (error) {
    release()
    throw error
  }
}

/** Stable fingerprints of non-secret declarations and source manifests only. */
export function declarationDigest(value: unknown): string {
  const stable = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(stable)
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => [key, stable(val)]),
      )
    return item
  }
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex')
}
