---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Build plugins keep `Intl.DateTimeFormat` off the hydration path (#1380).
`build-meta` and `build-info.client` no longer format the build time during
plugin setup: the client-only `build-time-local` meta tag and the `[build] ...`
console line appear after `app:mounted` once the browser is idle, and
`window.__NARDUK_BUILD__.localBuildTime` is formatted on first read. The
formatter is built once on first use and shared by both plugins and every
`formatBuildTimeLocal` caller. Output, the `__NARDUK_BUILD__` fields and
`__NARDUK_BUILD_LOGGED__` marker, and the server-rendered `build-time` and
`build-version` markers are unchanged; SSR HTML does not differ.
create-narduk-app: pin the new narduk-core.
