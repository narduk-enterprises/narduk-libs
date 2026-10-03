/**
 * Run `callback` once the browser is idle, so deployment-verification work
 * (the `build-time-local` meta tag, the `[build] ...` console line) stays off
 * the path to hydration (narduk-libs#1380). Browsers without
 * `requestIdleCallback` (Safari) get a short timeout instead.
 */
export function runWhenBrowserIdle(callback: () => void): void {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => callback(), { timeout: 3000 })
    return
  }
  setTimeout(callback, 200)
}
