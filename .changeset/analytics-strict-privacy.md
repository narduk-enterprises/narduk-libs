---
'@narduk-enterprises/narduk-analytics': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `nardukAnalytics.privacy: 'strict'` for apps whose pages hold private
records. PostHog then runs with no autocapture, rage clicks, dead clicks,
heatmaps, session replay, surveys, `/flags` request or remote extensions, and a
final `before_send` hook reduces every URL, pathname and referrer property —
including `$set`, `$set_once` and nested web-vitals payloads — to the matched
route pattern, drops page titles and element text, and reports exception
messages only in narduk-core's redacted form. GA4 receives route patterns as
`page_path`, `page_location` and `page_title`, with Google signals and ad
personalisation off. The option is build-time and wins over an app's own
`runtimeConfig.public.analyticsPrivacy`; the runtime-public overlay never
carries it, so a Worker variable cannot switch a strict app back to standard.
Standard apps see no change.
