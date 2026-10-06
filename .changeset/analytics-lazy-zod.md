---
'@narduk-enterprises/narduk-analytics': minor
'@narduk-enterprises/create-narduk-app': patch
---

Load Zod off the critical path (#1527). The shared event schemas now load with
`import()` on the first `capture()` or `v-track` click instead of landing in
every app's client entry chunk (about 17 KB gzipped in a generated app today,
and the rest of Zod's weight once the app's own catalog is lazy too). Captures
made before the schemas arrive are queued, validated with the same schemas and
sent in call order; an invalid event is still dropped. While the schemas load,
`capture()` returns `true` ("accepted for validation") instead of the validation
result.

Additive API: `defineAnalyticsEvents` and `searchQueryLengthBucket` are also
exported from the new Zod-free `app/lib/analyticsCatalog`, and `useAnalytics`
accepts a loader
(`() => import('../analytics/events').then((m) => m.productAnalyticsEvents)`) so
an app's own Zod schemas stay off the entry path too. `analyticsEvents` keeps
every export. The jitless CSP handling from #1310 is unchanged. Generated apps
now use the loader form.
