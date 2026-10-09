/**
 * Isolate-memory store behind `withWorkerCache` (narduk-libs#1716, #1268).
 *
 * One store per Worker isolate. It holds completed values as JSON text, never
 * live objects, so a request cannot mutate what another request reads, and the
 * byte budget is the real length of what is kept. It holds no promises, no
 * streams and no pending I/O: the only per-entry mutable state is two
 * timestamps (a refresh lease and a retry-after) that a request sets and the
 * same request clears.
 *
 * Lives outside `runtime/server/`, so Nitro's scan never auto-imports it into
 * apps; `withWorkerCache` is the public surface.
 */

export interface WorkerCacheStoreLimits {
  /** Total bytes kept across all entries (UTF-16, so two per character). */
  maxBytes: number
  /** Total entries kept. */
  maxEntries: number
}

export const DEFAULT_WORKER_CACHE_LIMITS: Readonly<WorkerCacheStoreLimits> = {
  maxBytes: 8 * 1024 * 1024,
  maxEntries: 256,
}

export interface WorkerCacheEntry {
  /** When the build that produced this value started (ms since epoch). */
  builtAt: number
  /** Approximate retained size: key and value at two bytes per character, plus overhead. */
  bytes: number
  /** Serialized value. */
  json: string
  /** Epoch ms until which another request must not start a refresh of this entry. */
  leaseUntil: number
  /** Epoch ms before which a failed refresh is not retried. */
  retryAfter: number
  /** Monotonic order of build starts within this isolate; breaks `builtAt` ties. */
  seq: number
}

export type WorkerCachePutResult = 'stored' | 'superseded' | 'too-large'

const ENTRY_OVERHEAD_BYTES = 96

export function entryBytes(key: string, json: string): number {
  return (key.length + json.length) * 2 + ENTRY_OVERHEAD_BYTES
}

export class WorkerCacheStore {
  limits: WorkerCacheStoreLimits
  private readonly entries = new Map<string, WorkerCacheEntry>()
  private totalBytes = 0
  private seqCounter = 0

  constructor(limits: Partial<WorkerCacheStoreLimits> = {}) {
    this.limits = { ...DEFAULT_WORKER_CACHE_LIMITS, ...limits }
  }

  get size(): number {
    return this.entries.size
  }

  get bytes(): number {
    return this.totalBytes
  }

  /** The next build-start order. Call once as a build begins, not when it ends. */
  nextSeq(): number {
    this.seqCounter += 1
    return this.seqCounter
  }

  /** Read an entry and mark it most recently used. */
  get(key: string): WorkerCacheEntry | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  delete(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    this.totalBytes -= entry.bytes
  }

  clear(): void {
    this.entries.clear()
    this.totalBytes = 0
  }

  /**
   * Keep a completed value unless a later-started build already stored one for
   * this key (an older refresh finishing last must not win), or it alone would
   * not fit the byte budget.
   */
  put(
    key: string,
    value: Pick<WorkerCacheEntry, 'builtAt' | 'json' | 'seq'>,
  ): { entry: WorkerCacheEntry | null; result: WorkerCachePutResult } {
    const existing = this.entries.get(key)
    if (existing && isNewer(existing, value)) return { entry: existing, result: 'superseded' }

    const bytes = entryBytes(key, value.json)
    if (bytes > this.limits.maxBytes) return { entry: null, result: 'too-large' }

    if (existing) this.delete(key)
    const entry: WorkerCacheEntry = { ...value, bytes, leaseUntil: 0, retryAfter: 0 }
    this.entries.set(key, entry)
    this.totalBytes += bytes
    this.evict()
    return { entry, result: 'stored' }
  }

  private evict(): void {
    for (const [key, entry] of this.entries) {
      if (this.totalBytes <= this.limits.maxBytes && this.entries.size <= this.limits.maxEntries) {
        return
      }
      this.entries.delete(key)
      this.totalBytes -= entry.bytes
    }
  }
}

/** True when `a` was built later than `b`: a later start time, or a later start at the same instant. */
export function isNewer(
  a: Pick<WorkerCacheEntry, 'builtAt' | 'seq'>,
  b: Pick<WorkerCacheEntry, 'builtAt' | 'seq'>,
): boolean {
  return a.builtAt > b.builtAt || (a.builtAt === b.builtAt && a.seq > b.seq)
}

let isolateStore: WorkerCacheStore | undefined

/** The per-isolate store. */
export function getWorkerCacheStore(): WorkerCacheStore {
  isolateStore ??= new WorkerCacheStore()
  return isolateStore
}

/** Drop the per-isolate store. Tests only. */
export function resetWorkerCacheStore(limits?: Partial<WorkerCacheStoreLimits>): WorkerCacheStore {
  isolateStore = new WorkerCacheStore(limits)
  return isolateStore
}
