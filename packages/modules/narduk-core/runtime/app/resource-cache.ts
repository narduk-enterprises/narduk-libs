/**
 * Keyed resources for a Pinia store (narduk-libs client caching, extracted from stonx's
 * `app/stores/helpers/resource-cache.ts`): each resource is read once, cached with its age and the
 * actor it belongs to, and shared by every page and the shell that ask for it.
 *
 * - `ensure(key, load)` answers the cached value while it is fresh, otherwise joins the request
 *   already out for that key, otherwise starts one. Concurrent callers share one request.
 * - `refresh(key, load)` always reads again; the read it replaces can no longer commit.
 * - `invalidate(key)` marks the entry stale (its data stays readable as last-good) and retires
 *   any read in flight, so a read that started before a write never lands after it.
 * - `reset()` drops every entry and retires every read: the store's part of an identity change.
 *
 * A response commits only if the actor epoch and the key's generation are what they were when
 * the request started. A read the epoch retired rejects with an AbortError; a read that was
 * invalidated while out hands its caller the replacing read's answer.
 *
 * Entries and errors are plain state refs owned by the store, so @pinia/nuxt serializes them
 * into the SSR payload and the client hydrates without asking again. Promises and generations
 * stay in this closure, out of the payload.
 *
 * Identity is injected (`epoch`, `actor`, `hydrating`), so this file needs only Vue and runs under
 * isolated Vitest. `defineCachedStore` (`./cached-store`) wires it to Pinia and Nuxt.
 *
 * Import it explicitly from `@narduk-enterprises/narduk-core/app/resource-cache`. It is not under
 * `app/composables` or `app/utils`, so it adds no auto-imported names to consuming apps.
 */
import { effectScope, getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'

import { useIntervalRefresh } from './composables/useIntervalRefresh'

export interface ResourceEntry<T = unknown> {
  actor: string | null
  data: T
  /** The actor epoch and id the answer belongs to. */
  epoch: number
  /** Epoch ms of the answer; 0 once invalidated (still readable, no longer fresh). */
  fetchedAt: number
}

export interface ResourceError {
  /** Epoch ms of the failure. */
  at: number
  epoch: number
  message: string
  statusCode: number | null
}

export interface ResourceCacheOptions {
  /** The signed-in user's id, null when signed out. */
  actor: () => string | null
  entries: Ref<Record<string, ResourceEntry>>
  /** The identity epoch; a change retires every read started before it. */
  epoch: () => number
  errors: Ref<Record<string, ResourceError>>
  /** True while the client hydrates the server's answer: a hydrated entry counts as fresh. */
  hydrating?: () => boolean
  now?: () => number
}

export interface EnsureOptions {
  /**
   * After a failed read, how long `ensure` keeps the failure (or the last answer it still holds)
   * instead of asking again, ms: a resource many readers mount against, such as the market status,
   * is then not read once per reader while its route is down. A `refresh` always asks.
   */
  retryMs?: number
  /** How long an answer stays fresh, ms. */
  staleMs: number
}

interface Flight {
  epoch: number
  gen: number
  promise: Promise<unknown>
}

function abortError(): Error {
  const error = new Error('The account changed while the request was out')
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError'
}

export function describeError(error: unknown): Omit<ResourceError, 'at' | 'epoch'> {
  const e = error as {
    data?: { message?: string }
    message?: string
    status?: number
    statusCode?: number
    statusMessage?: string
  } | null
  const statusCode = Number(e?.statusCode ?? e?.status)
  return {
    message: e?.data?.message || e?.statusMessage || e?.message || 'Request failed',
    statusCode: Number.isFinite(statusCode) ? statusCode : null,
  }
}

function callLoader<T>(load: () => Promise<T>): Promise<T> {
  try {
    return load()
  } catch (error) {
    return Promise.reject(error)
  }
}

export function createResourceCache(options: ResourceCacheOptions) {
  const { entries, errors, epoch, actor } = options
  const now = options.now ?? Date.now
  const hydrating = options.hydrating ?? (() => false)
  const flights = new Map<string, Flight>()
  const gens = new Map<string, number>()
  // Reactive so a view can show loading; not returned by the store, so never serialized.
  const pendingKeys = ref<Record<string, true>>({})

  const genOf = (key: string) => gens.get(key) ?? 0
  const bump = (key: string) => gens.set(key, genOf(key) + 1)

  function current(key: string): ResourceEntry | undefined {
    const entry = entries.value[key]
    if (!entry || entry.epoch !== epoch() || entry.actor !== actor()) return undefined
    return entry
  }

  function read<T>(key: string): T | undefined {
    return current(key)?.data as T | undefined
  }

  function isFresh(key: string, staleMs: number): boolean {
    const entry = current(key)
    if (!entry) return false
    if (hydrating()) return true
    if (!entry.fetchedAt) return false
    return withinAge(entry.fetchedAt, staleMs)
  }

  /**
   * True while `at` is less than `ms` old. A hydrated stamp comes from the server's clock: an age
   * below 0 means the client clock is behind, and counts as expired rather than as fresh (or
   * paused) for as long as the skew.
   */
  function withinAge(at: number, ms: number): boolean {
    const age = now() - at
    return age >= 0 && age < ms
  }

  function set<T>(key: string, data: T) {
    entries.value = {
      ...entries.value,
      [key]: { data, fetchedAt: now(), epoch: epoch(), actor: actor() },
    }
    if (key in errors.value) {
      const { [key]: _cleared, ...rest } = errors.value
      errors.value = rest
    }
  }

  /**
   * Change the cached value in place. Keeps its age, unless `fresh`: a write's own authoritative
   * answer, which then counts as just read. Both `fresh` and `retire` retire every read out now,
   * so none started before the write can commit over it (their callers get this answer); `retire`
   * alone suits a partial write (a realtime fill) that leaves the rest of the entry as old as it was.
   */
  function update<T>(
    key: string,
    change: (data: T) => T,
    opts: { fresh?: boolean; retire?: boolean } = {},
  ): boolean {
    const entry = current(key)
    if (!entry) return false
    if (opts.fresh || opts.retire) retire(key)
    const fetchedAt = opts.fresh ? now() : entry.fetchedAt
    entries.value = {
      ...entries.value,
      [key]: { ...entry, data: change(entry.data as T), fetchedAt },
    }
    return true
  }

  /** Retire the reads out for a key: their answers can no longer commit. */
  function retire(key: string) {
    bump(key)
    if (flights.has(key)) {
      flights.delete(key)
      setPending(key, false)
    }
  }

  function setPending(key: string, on: boolean) {
    if (on === key in pendingKeys.value) return
    if (on) pendingKeys.value = { ...pendingKeys.value, [key]: true }
    else {
      const { [key]: _done, ...rest } = pendingKeys.value
      pendingKeys.value = rest
    }
  }

  function start<T>(key: string, load: () => Promise<T>): Promise<T> {
    const startedEpoch = epoch()
    const startedGen = genOf(key)
    // Only this read may clear its own flight slot. `finally` always runs after the first await:
    // a loader that throws synchronously is a rejected read, not a throw.
    const flight: Flight = { promise: Promise.resolve(), gen: startedGen, epoch: startedEpoch }
    const promise: Promise<T> = (async () => {
      try {
        let data: T
        try {
          data = await callLoader(load)
        } catch (error) {
          if (epoch() !== startedEpoch) throw isAbortError(error) ? error : abortError()
          // A failure of a read that was replaced is not this key's error any more.
          if (genOf(key) !== startedGen) return await handOff<T>(key, load)
          errors.value = {
            ...errors.value,
            [key]: { ...describeError(error), at: now(), epoch: startedEpoch },
          }
          throw error
        }
        if (epoch() !== startedEpoch) throw abortError()
        // Invalidated while out: the caller gets the read that replaced this one.
        if (genOf(key) !== startedGen) return await handOff<T>(key, load)
        set(key, data)
        return data
      } finally {
        if (flights.get(key) === flight) {
          flights.delete(key)
          setPending(key, false)
        }
      }
    })()
    flight.promise = promise
    flights.set(key, flight)
    setPending(key, true)
    return promise
  }

  function join<T>(key: string): Promise<T> | undefined {
    const flight = flights.get(key)
    if (flight && flight.gen === genOf(key) && flight.epoch === epoch()) {
      return flight.promise as Promise<T>
    }
    return undefined
  }

  /**
   * The answer that replaced a superseded read: the read out now, else the answer it committed,
   * else (invalidated with nothing read since) a new read.
   */
  function handOff<T>(key: string, load: () => Promise<T>): Promise<T> {
    const out = join<T>(key)
    if (out) return out
    const entry = current(key)
    if (entry?.fetchedAt) return Promise.resolve(entry.data as T)
    return start(key, load)
  }

  function ensure<T>(key: string, load: () => Promise<T>, opts: EnsureOptions): Promise<T> {
    if (isFresh(key, opts.staleMs)) return Promise.resolve(read<T>(key) as T)
    const out = join<T>(key)
    if (out) return out
    const failed = opts.retryMs ? error(key) : null
    if (failed && withinAge(failed.at, opts.retryMs!)) {
      const held = current(key)
      if (held) return Promise.resolve(held.data as T)
      return Promise.reject(Object.assign(new Error(failed.message), failed))
    }
    return start(key, load)
  }

  /**
   * Hold a key's place for a read made outside `ensure` (a page bundle that also fills the entry):
   * the returned commit stores the answer only if the actor epoch and the key's generation are
   * what they were when the read started, so a read started before an `invalidate` that lands
   * after it is not stored as fresh. Returns whether it committed.
   */
  function capture(key: string): <T>(data: T) => boolean {
    const startedEpoch = epoch()
    const startedGen = genOf(key)
    return (data) => {
      if (epoch() !== startedEpoch || genOf(key) !== startedGen) return false
      set(key, data)
      return true
    }
  }

  function refresh<T>(key: string, load: () => Promise<T>): Promise<T> {
    bump(key)
    return start(key, load)
  }

  /** Mark stale and retire reads in flight; a key ending in ':' invalidates the whole prefix. */
  function invalidate(key: string) {
    const keys = key.endsWith(':')
      ? new Set([...Object.keys(entries.value), ...flights.keys()].filter((k) => k.startsWith(key)))
      : new Set([key])
    let next = entries.value
    for (const k of keys) {
      retire(k)
      const entry = next[k]
      if (entry?.fetchedAt) next = { ...next, [k]: { ...entry, fetchedAt: 0 } }
    }
    if (next !== entries.value) entries.value = next
  }

  function reset() {
    for (const k of new Set([...Object.keys(entries.value), ...flights.keys()])) bump(k)
    flights.clear()
    pendingKeys.value = {}
    entries.value = {}
    errors.value = {}
  }

  /**
   * Record a failed read made outside `ensure`/`refresh` (a page bundle's own request) as this
   * key's error, so it reaches the same state a cached read would. The last good answer stays
   * readable. An epoch abort is not a failure of the key.
   */
  function fail(key: string, cause: unknown) {
    if (isAbortError(cause)) return
    errors.value = {
      ...errors.value,
      [key]: { ...describeError(cause), at: now(), epoch: epoch() },
    }
  }

  function clearError(key: string) {
    if (!(key in errors.value)) return
    const { [key]: _cleared, ...rest } = errors.value
    errors.value = rest
  }

  /** Forget the entry and its error, and retire any read out: the resource is not this actor's to show. */
  function drop(key: string) {
    retire(key)
    if (key in entries.value) {
      const { [key]: _gone, ...rest } = entries.value
      entries.value = rest
    }
    clearError(key)
  }

  function error(key: string): ResourceError | null {
    const e = errors.value[key]
    return e && e.epoch === epoch() ? e : null
  }

  return {
    read,
    isFresh,
    isPending: (key: string) => key in pendingKeys.value,
    error,
    ensure,
    refresh,
    set,
    capture,
    fail,
    clearError,
    drop,
    update,
    invalidate,
    reset,
  }
}

export type ResourceCache = ReturnType<typeof createResourceCache>

export interface PollOptions {
  /** How often to read again while the page is visible, ms. */
  everyMs: number
}

/**
 * Shared polling for a resource cache: `poll(key, load, { everyMs })`, called in a component's
 * setup (or any effect scope), keeps `key` refreshed while that scope lives. However many scopes
 * poll one key, there is one timer for it, started by the first and stopped with the last.
 *
 * - The timer stops while the page is hidden; on return it reads once if a full interval has
 *   passed, then re-arms (`useIntervalRefresh`'s `pauseWhenHidden`).
 * - A tick goes through `ensure` with half the interval as its freshness, so it joins a read
 *   already out and skips a key some other caller read moments ago, instead of reading twice.
 * - A failed tick is kept as the key's error by the cache; the next tick tries again.
 * - On the server, and outside an effect scope, it does nothing.
 * - The first poller's `load` and `everyMs` drive the key's timer until the last poller goes; pass
 *   the same ones from every caller (a store method does this for you).
 */
export function createResourcePoller(resources: ResourceCache) {
  const polls = new Map<string, { holders: number; stop: () => void }>()

  function poll<T>(key: string, load: () => Promise<T>, opts: PollOptions): void {
    if (import.meta.server || !getCurrentScope() || !(opts.everyMs > 0)) return
    let held = polls.get(key)
    if (!held) {
      // Detached, so the timer outlives whichever caller started it.
      const scope = effectScope(true)
      scope.run(() =>
        useIntervalRefresh(
          async () => {
            try {
              await resources.ensure(key, load, { staleMs: opts.everyMs / 2 })
            } catch {
              // Recorded as the key's error (or an identity change's abort); nothing to rethrow.
            }
          },
          opts.everyMs,
          { pauseWhenHidden: true },
        ),
      )
      held = { holders: 0, stop: () => scope.stop() }
      polls.set(key, held)
    }
    const mine = held
    mine.holders++
    onScopeDispose(() => {
      if (--mine.holders > 0) return
      mine.stop()
      if (polls.get(key) === mine) polls.delete(key)
    })
  }

  return {
    poll,
    /** Keys with a running timer, for tests and diagnostics. */
    polling: () => [...polls.keys()],
  }
}

export type ResourcePoller = ReturnType<typeof createResourcePoller>
