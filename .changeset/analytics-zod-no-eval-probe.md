---
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

Stop the shared analytics catalog from triggering Zod's `new Function` probe. Zod 4 probes `Function`
the first time it builds an object schema, and an enforced no-eval CSP reports that caught probe as a
`script-src` violation on every page load (#1310). The standard events are now built inside
`withJitlessSchemas`, which sets Zod's `jitless` flag only for the duration of the build and restores
the app's value, so no global Zod configuration is imposed. `defineAnalyticsEvents` also accepts a
factory (`defineAnalyticsEvents(() => ({ ... }))`) so an app's own `z.object` schemas are built in the
same scope. Validation results are unchanged.
