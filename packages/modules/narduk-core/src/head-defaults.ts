/**
 * Mobile head defaults every narduk app inherits (mobile web QA rules 2, 5, 13,
 * 16 and 20). They are `app.head` entries, so the app's own value always wins,
 * three ways:
 *
 * - a key the app already set in `nuxt.config` `app.head` is left alone: a
 *   `viewport` that is not Nuxt's stock one, or any `meta` entry with the same
 *   `name` (for `theme-color`, any entry at all);
 * - `useHead()` / `useSeoMeta()` in a page or layout overrides the tag at
 *   render time, because unhead dedupes `meta` by `name`;
 * - `nardukCore: { head: false }` turns every default off.
 */

/** Nuxt's own stock viewport; an app that kept it did not choose a viewport. */
export const NUXT_DEFAULT_VIEWPORT = 'width=device-width, initial-scale=1'

/**
 * `viewport-fit=cover` is what makes `env(safe-area-inset-*)` non-zero. There is
 * deliberately no `maximum-scale` or `user-scalable`: they disable pinch zoom.
 */
export const MOBILE_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover'

/**
 * The browser-chrome colour: Nuxt UI's `bg-default` in each scheme (white, and
 * slate-900 for the default `neutral: 'slate'`), which is what the page paints.
 */
export const THEME_COLOR_LIGHT = '#ffffff'
export const THEME_COLOR_DARK = '#0f172a'

interface HeadMeta {
  [key: string]: unknown
  content?: unknown
  name?: unknown
}

export interface HeadOptionsLike {
  meta?: HeadMeta[]
  viewport?: string
}

const DEFAULT_META: HeadMeta[] = [
  { name: 'color-scheme', content: 'light dark' },
  { name: 'theme-color', content: THEME_COLOR_LIGHT, media: '(prefers-color-scheme: light)' },
  { name: 'theme-color', content: THEME_COLOR_DARK, media: '(prefers-color-scheme: dark)' },
  { name: 'format-detection', content: 'telephone=no' },
  { name: 'apple-mobile-web-app-capable', content: 'yes' },
  { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
]

/** Fills `app.head` in place with the defaults the app did not set. */
export function applyHeadDefaults(app: { head?: HeadOptionsLike }, enabled?: boolean): void {
  if (enabled === false) return
  const head = (app.head ??= {})

  if (!head.viewport || head.viewport === NUXT_DEFAULT_VIEWPORT) {
    head.viewport = MOBILE_VIEWPORT
  }

  const meta = (head.meta ??= [])
  const taken = new Set(meta.map((entry) => entry.name))
  for (const entry of DEFAULT_META) {
    if (!taken.has(entry.name)) meta.push({ ...entry })
  }
}
