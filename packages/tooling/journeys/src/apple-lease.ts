/**
 * Simulator ownership (narduk-libs#70, requirement 6).
 *
 * The world-session rule (§5) says exclusivity is enforced at the mutation
 * door, and on a simulator the door is the device: an install replaces the app
 * bundle under whatever is running, so two lanes sharing one simulator is not a
 * scheduling inconvenience, it is a capture filming the other lane's build.
 * A device is therefore LEASED for the run — the same holder-plus-expiry shape
 * the web loader's target lease has, one level down.
 *
 * Deliberately not a distributed lock. It is a file with a holder, a pid and an
 * expiry, on the one host that owns the simulator; a crashed holder's lease is
 * taken over when its pid is gone or its expiry has passed. That is
 * proportionate for a capture tool on a single Mac, and §5 says so in as many
 * words about the web side.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface SimulatorLeaseRecord {
  udid: string
  holder: string
  pid: number
  acquiredAt: string
  expiresAt: string
}

export interface SimulatorLease {
  record: SimulatorLeaseRecord
  /** Push the expiry out; call at journey boundaries on a long session. */
  renew(): void
  /** Release only if this holder still owns the file. */
  release(): void
}

export interface AcquireLeaseOptions {
  udid: string
  /** Who is asking. Appears verbatim in the refusal a rival lane reads. */
  holder: string
  /** Default: `<tmpdir>/njr-simulator-leases`. */
  leaseDir?: string
  /** Default: 45 minutes. */
  ttlMs?: number
  /** Injected for tests; defaults to `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean
  now?: () => number
  pid?: number
}

const DEFAULT_TTL_MS = 45 * 60 * 1000

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLease(path: string): SimulatorLeaseRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as SimulatorLeaseRecord
  } catch {
    return null
  }
}

/**
 * Take the device, or refuse loudly. A live rival lease is a hard failure at
 * acquisition time — never a wait, never a fallback device, and never a
 * shrug: contention that fails fast beats a run whose evidence turns out to be
 * about somebody else's build.
 */
export function acquireSimulatorLease(options: AcquireLeaseOptions): SimulatorLease {
  const leaseDir = options.leaseDir ?? join(tmpdir(), 'njr-simulator-leases')
  const now = options.now ?? Date.now
  const isAlive = options.isAlive ?? defaultIsAlive
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const pid = options.pid ?? process.pid
  mkdirSync(leaseDir, { recursive: true })
  const path = join(leaseDir, `${options.udid}.json`)

  const build = (): SimulatorLeaseRecord => ({
    udid: options.udid,
    holder: options.holder,
    pid,
    acquiredAt: new Date(now()).toISOString(),
    expiresAt: new Date(now() + ttlMs).toISOString(),
  })

  const write = (record: SimulatorLeaseRecord, exclusive: boolean): void => {
    if (exclusive) {
      writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' })
      return
    }
    const temporary = `${path}.tmp-${pid}`
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`)
    renameSync(temporary, path)
  }

  let record = build()
  try {
    write(record, true)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = readLease(path)
    const expired = !existing || Date.parse(existing.expiresAt) <= now()
    const dead = !existing || !isAlive(existing.pid)
    if (!expired && !dead) {
      throw new Error(
        `simulator ${options.udid} is leased by "${existing.holder}" (pid ${existing.pid}) ` +
          `until ${existing.expiresAt}. Two lanes on one simulator film each other's builds; ` +
          'wait for it, or run this lane on its own device.',
      )
    }
    write(record, false)
  }

  const heldByUs = (): boolean => {
    const current = readLease(path)
    return current?.holder === record.holder && current.pid === record.pid
  }

  return {
    get record() {
      return record
    },
    renew() {
      if (!heldByUs()) {
        throw new Error(`lost the lease on simulator ${options.udid} mid-session`)
      }
      record = { ...record, expiresAt: new Date(now() + ttlMs).toISOString() }
      write(record, false)
    },
    release() {
      if (heldByUs()) rmSync(path, { force: true })
    },
  }
}
