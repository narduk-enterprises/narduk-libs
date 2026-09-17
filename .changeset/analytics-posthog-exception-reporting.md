---
'@narduk-enterprises/narduk-analytics': minor
---

Report exceptions to PostHog by subscribing to narduk-core's `narduk:exception`
seam. This module registers a destination and installs no error listeners of its
own; the capture sites belong to narduk-core.

Reporting goes through `posthog.captureException()`, PostHog's own documented
API, which emits the same `$exception` event exception autocapture emits — so
PostHog's Error tracking UI works with no further setup.

`capture_exceptions` autocapture is deliberately not used. It is an _externally
loaded_ extension
(`loadExternalDependency(instance, 'exception-autocapture', …)`) and that loader
refuses to run whenever `disable_external_dependency_loading` is set, which is
this module's default posture whenever session replay is off — exactly the gap
`$web_vitals` hit. Enabling it would be a switch that silently does nothing;
`captureException()` is bundled in the main module and works under that posture
unchanged.

`$exception` carries the matched route _pattern_ (never a raw path), the source,
status code, fatal flag, redacted message, build version and request id. Nothing
is reported when analytics never initialized — no key, `previewSafeMode`,
localhost, `analyticsLoadStrategy: 'off'` — or when the visitor has opted out.
