/**
 * Stale-chunk recovery for a tab that outlived a deploy.
 *
 * A Cloudflare Workers deploy replaces the build's hashed `/_nuxt/*.js`
 * chunks, so a tab opened before the deploy asks for a file that no longer
 * exists the next time it navigates. The browser reports that as one of three
 * messages, and without recovery the app's error page shows a 500. One hard
 * reload fetches the new entry and the new chunk names; this file decides
 * whether that reload may happen, and nothing here touches Nuxt or the DOM, so
 * all of it is unit-testable and an app's own error page can import it:
 *
 *   import { isChunkLoadError } from '@narduk-enterprises/narduk-core/shared/chunk-reload'
 *
 * The runtime wiring lives in `runtime/app/plugins/chunk-reload.client.ts`.
 * Opt out with `appConfig.narduk.chunkReload = false`.
 */

/** sessionStorage key holding the epoch milliseconds of the last chunk reload. */
export const CHUNK_RELOAD_STORAGE_KEY = 'narduk:chunk-reload'

/**
 * A second chunk failure inside this window is not reloaded for. If the fresh
 * build is itself missing a chunk (a broken deploy, a CDN that has not caught
 * up), looping would hammer the origin; the error page is the right outcome.
 */
export const CHUNK_RELOAD_WINDOW_MS = 10_000

const CHUNK_ERROR_PATTERNS: readonly RegExp[] = [
  // Safari
  /importing a module script failed/i,
  // Chrome, Edge
  /failed to fetch dynamically imported module/i,
  // Firefox
  /error loading dynamically imported module/i,
  // Vite's preload helper, for a stylesheet chunk that is gone.
  /unable to preload css/i,
  // webpack-style names that some tooling and extensions still produce.
  /loading (?:css )?chunk [\w-]+ failed/i,
  /\bChunkLoadError\b/,
]

/**
 * True when `input` is the message (or an error/object carrying one) that a
 * browser throws for a dynamic `import()` whose file is gone. Matches the
 * message only, so an unrelated error that merely mentions "module" does not
 * trigger a reload.
 */
export function isChunkLoadError(input: unknown): boolean {
  const message = readMessage(input)
  return message !== undefined && CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

function readMessage(input: unknown): string | undefined {
  if (typeof input === 'string') return input
  if (input !== null && typeof input === 'object') {
    const record = input as { message?: unknown; name?: unknown }
    const message = typeof record.message === 'string' ? record.message : ''
    // `ChunkLoadError` is carried in `name`, not always in the message.
    const name = typeof record.name === 'string' ? record.name : ''
    const joined = `${name} ${message}`.trim()
    return joined === '' ? undefined : joined
  }
  return undefined
}

/** The slice of `Storage` the guard uses. */
export interface ChunkReloadStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Claims the one reload this window allows. Returns true exactly when the
 * caller may reload now, and records the time so the next call inside
 * `windowMs` returns false. Fails closed: with no storage, or storage that
 * throws (Safari private mode, blocked site data), it returns false, because a
 * reload the guard cannot remember is a reload loop.
 */
export function claimChunkReload(
  storage: ChunkReloadStorage | null | undefined,
  now: number,
  windowMs: number = CHUNK_RELOAD_WINDOW_MS,
): boolean {
  if (!storage) return false
  try {
    const raw = storage.getItem(CHUNK_RELOAD_STORAGE_KEY)
    const last = raw === null ? Number.NaN : Number(raw)
    const elapsed = now - last
    // A timestamp in the future (clock change) counts as "not recent": the
    // write below replaces it, so the guard still holds from now on.
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < windowMs) return false
    storage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now))
    return true
  } catch {
    return false
  }
}

/** Reads `appConfig.narduk.chunkReload`; only an explicit `false` opts out. */
export function isChunkReloadEnabled(appConfig: unknown): boolean {
  if (appConfig === null || typeof appConfig !== 'object') return true
  const narduk = (appConfig as { narduk?: unknown }).narduk
  if (narduk === null || typeof narduk !== 'object') return true
  return (narduk as { chunkReload?: unknown }).chunkReload !== false
}

export interface ChunkReloadEnvironment {
  /** Current epoch milliseconds. */
  now(): number
  /** Hard-navigates to `url` (a reload when it is the current page). */
  reload(url: string): void
  /** `sessionStorage`, or null when the browser withholds it. */
  storage: ChunkReloadStorage | null
}

/**
 * Reloads to `url` unless a chunk reload already happened inside the window.
 * Returns true when it reloaded, so a `vite:preloadError` listener knows to
 * `preventDefault()` (suppress the error) and otherwise let the error through
 * to the app's error page.
 */
export function reloadForChunkError(env: ChunkReloadEnvironment, url: string): boolean {
  if (!claimChunkReload(env.storage, env.now())) return false
  env.reload(url)
  return true
}
