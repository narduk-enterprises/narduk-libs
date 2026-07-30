/**
 * Shared build-time configuration for the five status applications.
 *
 * Everything here was duplicated verbatim across app nuxt.config files before
 * extraction. Add to this package rather than re-copying a block into a sixth
 * app; anything genuinely generic to every Narduk app (not just the status
 * five) belongs upstream in @narduk-enterprises/narduk-core instead.
 */

/**
 * Resolve the exact source revision the build is being produced from.
 *
 * Order matters: an explicit NARDUK_SOURCE_REVISION set by the release
 * workflow wins over the ambient CI variables, so an exact-SHA upload always
 * stamps the SHA it was authorized for rather than whatever the runner
 * happened to check out.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} the revision, or an empty string outside CI
 */
export function resolveSourceRevision(env = process.env) {
  return (
    env.NARDUK_SOURCE_REVISION?.trim() ||
    env.WORKERS_CI_COMMIT_SHA?.trim() ||
    env.GITHUB_SHA?.trim() ||
    ""
  );
}

/**
 * The design system's font request.
 *
 * Narduk Status Design System v1.0 uses exactly two families in three weights
 * each, in a single request: Instrument Sans for interface and prose, IBM Plex
 * Mono for every measured number and all metadata. Schibsted Grotesk, Inter and
 * Outfit are dropped from the estate.
 *
 * Spread into `app.head.link` so all five apps make the identical request and
 * share one browser cache entry.
 */
export const designSystemFontLinks = Object.freeze([
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  // `crossorigin` is annotated rather than inferred: Nuxt's head Link type
  // accepts only "" | "anonymous" | "use-credentials", and a widened `string`
  // fails every consuming app's `nuxt typecheck`.
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: /** @type {""} */ ("") },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700&display=swap",
  },
]);

/**
 * The design system's page-ground colour, for `<meta name="theme-color">`.
 * This is --ns-ink, the bezel base, expressed in rgb() because the estate lint
 * rule forbids hardcoded hex in component and config source.
 */
export const designSystemThemeColor = "rgb(14 20 24)";
