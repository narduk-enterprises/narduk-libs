import { sanitizeLocalRedirectPath } from './safeRedirectPath'

/**
 * Where a successful sign-in lands, as a full page load.
 *
 * Every sign-in path ends in a full page load, never a client-side `navigateTo`
 * (D-HTML-CACHE-PUBLIC-1): an app may edge-cache anonymous HTML
 * (`nardukCore.htmlCache`), and a client-side navigation would carry the script of
 * a cached public page into the signed-in session. Pass the result to
 * `navigateTo(path, { external: true, replace: true })`.
 *
 * `target` is the server's `redirectTo` or the sanitized `next`; it is validated
 * again here as a same-origin path, and anything else becomes `fallback`.
 */
export function signInLandingPath(target: unknown, fallback: string): string {
  return sanitizeLocalRedirectPath(target, fallback)
}

/** The `navigateTo` options that make a sign-in redirect a full page load. */
export const FULL_PAGE_LOAD = { external: true, replace: true } as const
