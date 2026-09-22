---
'@narduk-enterprises/narduk-analytics': minor
---

The build now fails when narduk-core is registered with `app: false` while
narduk-analytics' client half is on (narduk-libs#663). narduk-core registers the
runtime-public overlay only when its `app` option is on, so that shape passed
the "is narduk-core installed" guard and ran the analytics client plugins with
no PostHog key, GA id or deployment target. The result was no analytics and no
signal. The guard reads the `nardukCore` key and inline `[narduk-core, options]`
module tuples. To fix a failing build, turn `nardukCore.app` back on, or set
`nardukAnalytics.app: false` to keep only the server routes.
