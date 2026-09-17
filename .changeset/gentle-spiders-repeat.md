---
'@narduk-enterprises/narduk-testkit': patch
---

Add an opt-in deterministic telemetry profile to `createConsoleTracker`.
`telemetry: 'stub'` fulfils optional-telemetry requests (Cloudflare Insights,
Google Tag Manager, Google Analytics, PostHog, plus caller-supplied
`extraTelemetryHosts`) with 204 and drops those origins' resource-load console
and `pageerror` entries, so a console-cleanliness assertion measures the app
rather than whether the machine running it can reach an analytics CDN. The
default stays `'live'`, and first-party errors, hydration warnings, and every
other console error remain fatal in both modes. The second argument still
accepts a bare `RegExp[]`.
