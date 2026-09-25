/**
 * Hydration-safe, validated, failure-tolerant Web Storage state
 * (narduk-libs#993).
 *
 * Apps keep per-browser conveniences (a sidebar's open state, a basemap, a
 * dismissed guide) in `localStorage` and converge on one contract: render the
 * default on the server and first paint, read the stored value after mount,
 * validate it, and swallow storage failures so the feature degrades to "this
 * visit only". The hand-rolled copies each dropped a clause: an unguarded
 * `setItem` in a watcher throws on every change when storage is blocked or
 * full, and an unvalidated `JSON.parse` lands in typed state.
 *
 * - `createStoredState(key, options)` is the pure half: `read`, `write` and
 *   `remove`, each individually try/caught, including the `window.localStorage`
 *   property access itself, which throws `SecurityError` when storage is
 *   blocked.
 * - `useStoredState(key, options)` is the composable: a `Ref<T>` holding the
 *   default until mount, then the stored value, written back on change, with
 *   `.clear()` to remove the key and restore the default.
 *
 * The key is used exactly as given, with no prefix, so an app adopting this
 * keeps its viewers' stored choices.
 *
 * Import it explicitly from `@narduk-enterprises/narduk-core/app/stored-state`.
 * It is not under `app/composables` or `app/utils`, so it adds no auto-imported
 * names to consuming apps.
 */

import { onMounted, ref, watch } from 'vue'

import type { Ref } from 'vue'

/** Which Web Storage area to use. */
export type StoredStateArea = 'local' | 'session'

export interface StoredStateOptions<T> {
  /** Value on the server, on first paint, and whenever nothing valid is stored. */
  default: T | (() => T)
  /**
   * Turns the stored string into a value; `undefined` means "use the default".
   * Defaults to `JSON.parse`. A throw is treated as `undefined`.
   */
  parse?: (raw: string) => T | undefined
  /** Turns a value into the stored string. Defaults to `JSON.stringify`. */
  serialize?: (value: T) => string
  /** Web Storage area. Defaults to `'local'`. */
  storage?: StoredStateArea
  /**
   * Accepts a parsed value. Without it, and without `parse`, a stored value is
   * accepted only when it has the default's JSON type (string, number,
   * boolean, array or object) — never cast blind into typed state.
   */
  validate?: (value: unknown) => value is T
}

export interface StoredState<T> {
  /** The stored value, or `undefined` when there is none, it is invalid, or storage fails. */
  read: () => T | undefined
  /** Removes the key. `false` when storage is unavailable or refused. */
  remove: () => boolean
  /** Stores `value`. `false` when storage is unavailable or refused (quota, blocked). */
  write: (value: T) => boolean
}

/** A `Ref<T>` that also clears its key. */
export type StoredStateRef<T> = Ref<T> & {
  /** Removes the key and restores the default. */
  clear: () => void
}

/**
 * The Web Storage area, or `null` on the server or when the browser refuses
 * it. Reading `window.localStorage` itself throws when storage is blocked, so
 * the property access is inside the try.
 */
export function resolveWebStorage(area: StoredStateArea = 'local'): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return (area === 'session' ? window.sessionStorage : window.localStorage) ?? null
  } catch {
    return null
  }
}

function resolveDefault<T>(value: T | (() => T)): T {
  return typeof value === 'function' ? (value as () => T)() : value
}

function jsonType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * The pure half of {@link useStoredState}: read, write and remove one key,
 * each failure-tolerant. `getStorage` is for tests; it defaults to the
 * `options.storage` area of `window`.
 */
export function createStoredState<T>(
  key: string,
  options: StoredStateOptions<T>,
  getStorage: () => Storage | null = () => resolveWebStorage(options.storage),
): StoredState<T> {
  const serialize = options.serialize ?? ((value: T) => JSON.stringify(value))
  const accepts = (value: unknown): value is T => {
    if (options.validate) return options.validate(value)
    if (options.parse) return value !== undefined
    return jsonType(value) === jsonType(resolveDefault(options.default))
  }

  return {
    read() {
      try {
        const raw = getStorage()?.getItem(key)
        if (raw === null || raw === undefined) return
        const value: unknown = options.parse ? options.parse(raw) : JSON.parse(raw)
        return accepts(value) ? value : undefined
      } catch {
        return
      }
    },
    remove() {
      try {
        const storage = getStorage()
        if (!storage) return false
        storage.removeItem(key)
        return true
      } catch {
        return false
      }
    },
    write(value) {
      try {
        const storage = getStorage()
        if (!storage) return false
        storage.setItem(key, serialize(value))
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * A `Ref<T>` backed by Web Storage. The server and first paint hold the
 * default; the stored value is applied in `onMounted`, so hydration matches.
 * Later changes are written back (deeply, after render). Every storage access
 * is failure-tolerant, so blocked or full storage leaves a working in-memory
 * ref for this visit.
 *
 * Call it from a component's `setup`.
 */
export function useStoredState<T>(key: string, options: StoredStateOptions<T>): StoredStateRef<T> {
  const store = createStoredState(key, options)
  const state = ref(resolveDefault(options.default)) as Ref<T>
  let watching = false
  let skipWrite = false

  onMounted(() => {
    const stored = store.read()
    if (stored !== undefined) state.value = stored

    // Registered after the restore, so restoring never writes the value back.
    // Deep on purpose: an object value (a prefs record, a watchlist) is
    // usually changed in place, and each change must reach storage.
    /* vue-official allow-deep-watch */
    watch(
      state,
      (value) => {
        if (skipWrite) {
          skipWrite = false
          return
        }
        store.write(value)
      },
      { deep: true, flush: 'post' },
    )
    watching = true
  })

  const clear = () => {
    const fallback = resolveDefault(options.default)
    if (!Object.is(fallback, state.value)) {
      // The watcher would write the default straight back; skip that one write.
      skipWrite = watching
      state.value = fallback
    }
    store.remove()
  }

  return Object.assign(state, { clear })
}
