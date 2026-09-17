---
'@narduk-enterprises/narduk-analytics': minor
---

Report Core Web Vitals to PostHog, behind a new opt-in `posthogWebVitalsEnabled`
flag (`POSTHOG_WEB_VITALS_ENABLED`), off by default like every other PostHog
capture feature in this module.

This is PostHog's own `$web_vitals` autocapture rather than a second pipeline.
`posthog-js` already ships a `webVitalsAutocapture` extension that buffers
LCP/CLS/FCP/INP and emits one `$web_vitals` event, switched on with
`capture_performance: { web_vitals: true }` — so PostHog's built-in Web Vitals
dashboard works with no further setup.

The extension does not bundle the measurement code, though: it fetches
`/static/web-vitals.js` from the PostHog host unless
`window.__PosthogExtensions__.postHogWebVitalsCallbacks` is already populated,
and that fetch is refused whenever `disable_external_dependency_loading` is set
— this module's default whenever session replay is off. So `posthog.client` now
publishes those callbacks itself from the pinned `web-vitals` package (the same
library, and the same object PostHog's own asset publishes) before calling
`posthog.init`. No extra network request, and the module's external-dependency
posture is unchanged.

A `before_send` hook enriches `$web_vitals` events — and only those events —
with the matched `route` pattern (never a raw path, so record ids stay out of
PostHog), the deployed `build_version` SHA, and connection/device class where
the browser exposes it. The app id already rides along as the existing `app`
super property.

`capture_performance.web_vitals` is also pinned explicitly to `false` when the
flag is off, so a PostHog project-side `capturePerformance` remote config can no
longer start collecting vitals for an app that has not opted in. Every existing
analytics gate still applies first: nothing is captured in preview safe mode,
without a PostHog key, on a local host, or with `analyticsLoadStrategy: 'off'`.

`POSTHOG_WEB_VITALS_ATTRIBUTION_ENABLED` switches to the
`web-vitals/attribution` build for regression investigations; it is off by
default because it roughly doubles that lazily-imported chunk.

TTFB is not included: `SupportedWebVitalsMetrics` in `posthog-js` is exactly
`LCP | CLS | FCP | INP`, and adding TTFB would mean a second, parallel event
stream.
