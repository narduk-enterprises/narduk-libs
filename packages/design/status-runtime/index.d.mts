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
 * The Narduk Status Design System font request shared by all five status apps.
 */
export const designSystemFontLinks: ReadonlyArray<
  | {
      crossorigin?: undefined;
      href: string;
      rel: string;
    }
  | {
      crossorigin: "";
      href: string;
      rel: string;
    }
>;

/**
 * The design system's page-ground colour for `<meta name="theme-color">`.
 */
export const designSystemThemeColor: "rgb(14 20 24)";
