---
'@narduk-enterprises/narduk-core': minor
---

Ship the estate error page and a shared exception-capture seam, so every app
that pins narduk-core gets both with no file of its own.

**The error page reaches apps through Nuxt, not through a copy.** The module
sets `app.errorComponent` from the `app:resolve` hook. Nuxt's own `resolveApp()`
assigns that field immediately before calling the hook — an `app/error.*` from
the project or any layer when one exists, and otherwise Nuxt's built-in
`nuxt-error-page.vue` — so replacing only the built-in leaves an app-owned error
page winning and needs no shim, no generator copy and no upgrade codemod. Apps
install this package as a module rather than a layer, which is why
`runtime/app/error.vue` was previously dead code: nothing referenced it and the
layer-directory path Nuxt scans never reached it.

The page now shows the **request id** — the same value `x-request-id` carries
and the one every narduk-logging record is keyed by — resolved during SSR and
transferred through the Nuxt payload, because a browser cannot read the response
header of its own document. `requestLogger` also echoes the id back onto the
incoming request headers so a re-entrant render of the failed page adopts it
rather than minting a second one. It adds copy for 429 and 503, `data-testid`
hooks for E2E, and a diagnostic detail line gated on `previewSafeMode` so a raw
error message never reaches production traffic.

**Exception capture is one seam.** A client plugin (`vue:error`, `app:error`)
and a Nitro plugin (`error`) publish one report per error on a
`narduk:exception` hook carried on the runtime's own bus. Reports carry the
route _pattern_ — never a raw path — plus the build version, request id and
status code, with query strings and email addresses redacted out of the message.
Duplicate announcements are collapsed: `vue:error` and `app:error` both fire
when a component failure is escalated, and Nitro can announce one handled error
twice.

Neither plugin logs. narduk-logging already writes exactly one record per
failing request (narduk-libs#359), so a record here would double every server
error. Server records now also carry `buildVersion`.

New export `@narduk-enterprises/narduk-core/app/error-page` for an app that
wants to wrap the page rather than fork it.
