/**
 * Resolve the exact source revision the build is being produced from.
 *
 * An explicit `NARDUK_SOURCE_REVISION` wins over the ambient CI variables.
 *
 * @param env environment values to resolve; defaults to `process.env`
 * @returns the revision, or an empty string outside CI
 */
export function resolveSourceRevision(env?: Record<string, string | undefined>): string;

/**
 * Retired (narduk-libs#1366): always empty. narduk-core 2.22.0 or later
 * self-hosts the design system's families through `@nuxt/fonts`; remove the
 * spread from `app.head.link`.
 *
 * @deprecated
 */
export const designSystemFontLinks: ReadonlyArray<{
  crossorigin?: "";
  href: string;
  rel: string;
}>;

/**
 * The design system's page-ground colour for `<meta name="theme-color">`.
 */
export const designSystemThemeColor: "rgb(14 20 24)";
