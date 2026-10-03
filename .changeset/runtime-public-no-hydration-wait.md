---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core: hydration no longer waits on `GET /api/runtime/public` (#1368). A
live SSR response now embeds the request's full public overlay in the payload
(a new `runtime-public-payload` server plugin; the Nitro `00-runtime-public`
plugin leaves it on `event.context.runtimePublicOverlay`), and the browser
`runtime-public` plugin applies it synchronously, so no Worker round trip sits
between the entry script and the mount. Every key (deployment target,
preview-safe mode, auth, analytics) is still applied before any plugin that
`dependsOn: ['runtime-public']` runs. HTML with no trustworthy embedded overlay
(prerendered pages, or a server that predates this plugin) keeps the awaited
fetch; embedded values older than a minute (cached HTML) are refreshed in the
background. `/api/runtime/public` is unchanged.
create-narduk-app: pin the new narduk-core.
