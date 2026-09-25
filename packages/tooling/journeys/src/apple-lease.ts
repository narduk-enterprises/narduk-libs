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
 *
 * Creating a free lease is one exclusive create, so it cannot race. Replacing
 * a lease is a read, a decision and a write, so every replacement (takeover,
 * renew, release) runs under `<udid>.json.lock`, itself an exclusive create,
 * and re-reads the lease inside it: two lanes that both saw the same stale
 * lease cannot both take it (#880). A lane that finds the lock taken refuses
 * rather than waits, like any other contention here.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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

function leaseIsLive(
  record: SimulatorLeaseRecord | null,
  now: number,
  isAlive: (pid: number) => boolean,
): record is SimulatorLeaseRecord {
  return record !== null && Date.parse(record.expiresAt) > now && isAlive(record.pid)
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

  const leasedBy = (existing: SimulatorLeaseRecord): Error =>
    new Error(
      `simulator ${options.udid} is leased by "${existing.holder}" (pid ${existing.pid}) ` +
        `until ${existing.expiresAt}. Two lanes on one simulator film each other's builds; ` +
        'wait for it, or run this lane on its own device.',
    )

  /**
   * Run `body` holding the mutation lock, or return `onBusy()` without it. The
   * lock lives for one read and one write; a lock whose pid is gone was left
   * by a crash inside that window and is named so an operator can delete it.
   */
  const lockPath = `${path}.lock`
  const withLock = <T>(onBusy: (lockPid: string) => T, body: () => T): T => {
    try {
      writeFileSync(lockPath, `${pid}\n`, { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let lockPid = 'unknown'
      try {
        lockPid = readFileSync(lockPath, 'utf8').trim() || lockPid
      } catch {
        // Released between our create and our read; still busy for this call.
      }
      return onBusy(lockPid)
    }
    try {
      return body()
    } finally {
      rmSync(lockPath, { force: true })
    }
  }

  let record = build()
  try {
    write(record, true)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const seen = readLease(path)
    if (leaseIsLive(seen, now(), isAlive)) throw leasedBy(seen)
    withLock(
      (lockPid) => {
        throw new Error(
          `simulator ${options.udid} is being taken over by another lane (pid ${lockPid}) ` +
            `right now. If pid ${lockPid} is gone, delete ${lockPath}.`,
        )
      },
      () => {
        // Decide again under the lock: another lane may have replaced or
        // released the lease since `seen` was read.
        const current = readLease(path)
        if (leaseIsLive(current, now(), isAlive)) throw leasedBy(current)
        record = build()
        // Under the lock the file only appears (a free-lease create never takes
        // it) and never disappears, so a missing file is created exclusively.
        try {
          write(record, !existsSync(path))
        } catch (raced) {
          const winner = readLease(path)
          if ((raced as NodeJS.ErrnoException).code === 'EEXIST' && winner) throw leasedBy(winner)
          throw raced
        }
      },
    )
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
      const lost = (): Error => new Error(`lost the lease on simulator ${options.udid} mid-session`)
      // A busy lock is a rival deciding whether this lease is stale. While it
      // is ours and unexpired the rival will refuse, so skip this renewal and
      // let the next boundary renew; otherwise the rival is taking it.
      withLock(
        () => {
          if (heldByUs() && Date.parse(record.expiresAt) > now()) return
          throw lost()
        },
        () => {
          if (!heldByUs()) throw lost()
          record = { ...record, expiresAt: new Date(now() + ttlMs).toISOString() }
          write(record, false)
        },
      )
    },
    release() {
      // Busy: another lane is taking the (expired) lease, so it is not ours to delete.
      withLock(
        () => {},
        () => {
          if (heldByUs()) rmSync(path, { force: true })
        },
      )
    },
  }
}
