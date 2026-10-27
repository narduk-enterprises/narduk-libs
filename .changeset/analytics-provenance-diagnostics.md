---
'@narduk-enterprises/narduk-analytics': minor
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-analytics: every event now carries `capture_origin` (`browser|server|synthetic`) and `analytics_sdk_version` beside `app_id`, `site`, `build_version` and the schema version; dev and test builds warn when `app_id` falls back to the hostname or a browser event has no `$session_id`. Deferred initialization no longer loses the landing pageview (#1906): captures expire one by one, `interaction` never expires them, and a full queue evicts the oldest non-pageview capture instead of failing the visit. `useAnalytics().diagnostics` exposes bounded delivery counters, and events held before init carry `analytics_queue_delay_ms` and `analytics_load_strategy`. The default ingest host is `https://p.nard.uk` (#2048); explicit overrides still win. `buildServerCaptureProvenance` stamps server and synthetic captures.

narduk-core: `runtimeConfig.public.posthogHost` defaults to `https://p.nard.uk`; the CSP still allows PostHog Cloud for an explicit override.
