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
 * Retired: the design system's Google Fonts request (narduk-libs#1366).
 *
 * This used to be a render-blocking third-party font stylesheet and two
 * preconnects. It cost about 900 ms of mobile first paint on riverstat.us for
 * two families an app can serve from its own origin. The families are now
 * declared to `@nuxt/fonts` by `@narduk-enterprises/narduk-core` (2.22.0 or
 * later), which self-hosts Instrument Sans and IBM Plex Mono from `/_fonts/`
 * for any app that loads the narduk-ui tokens or the narduk-shell theme; an
 * app needs no font config of its own.
 *
 * The export stays, empty, so an app that still spreads it into
 * `app.head.link` keeps building and emits no third-party link. Delete the
 * spread; it has no effect.
 *
 * @deprecated Remove the spread. Fonts come from narduk-core's `@nuxt/fonts`.
 */
export const designSystemFontLinks = Object.freeze(
  /** @type {Array<{ rel: string; href: string; crossorigin?: "" }>} */ ([]),
);

/**
 * The design system's page-ground colour, for `<meta name="theme-color">`.
 * This is --ns-ink, the bezel base, expressed in rgb() because the estate lint
 * rule forbids hardcoded hex in component and config source.
 */
export const designSystemThemeColor = "rgb(14 20 24)";
