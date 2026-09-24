/**
 * narduk-libs#170: registered when `nuxt-og-image` is not installed so
 * `useSeo` and app `defineOgImage()` calls keep resolving from `#imports`.
 */
export function defineOgImage(_component?: unknown, _props?: unknown, _options?: unknown): void {}
