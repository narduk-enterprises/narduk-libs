# @narduk-enterprises/narduk-core

Core UI, worker runtime, and shared utilities.

First-class Nuxt package source in this workspace.

Generic shell primitives such as `AppBreadcrumbs` live here; AI runtime and
admin surfaces now belong to `@narduk-enterprises/narduk-ai` in
`packages/modules/narduk-ai/`.

> [!NOTE] Public SEO and Schema.org capabilities have been moved to
> `@narduk-enterprises/narduk-seo` in `packages/modules/narduk-seo/`. Internal
> SPA apps and operator consoles can use only `@narduk-enterprises/narduk-core`
> without loading public formatting dependencies. Public websites should
> explicitly register the SEO package and use `useSeo(...)` for proper
> structured metadata.

Nitro OpenAPI generation is enabled here for all downstream apps. By default,
production builds prerender `/_openapi.json`, while the Scalar and Swagger UI
routes stay disabled unless an app opts into `nitro.openAPI.ui`. Set
`NUXT_OPENAPI_PRODUCTION=runtime` to serve the spec dynamically or
`NUXT_OPENAPI_PRODUCTION=false` to disable the production route entirely.

The core security headers keep browser geolocation disabled by default. Apps
that intentionally need user-location prompts can set
`NUXT_PUBLIC_ALLOW_GEOLOCATION=true` to emit
`Permissions-Policy: geolocation=(self)` while leaving camera and microphone
blocked. With the `security.headers` preset on, the variable is read at build
time. An explicit `security.headers.permissionsPolicy.geolocation` wins over it.

`useCurrentLocation()` is the consent-first way to read that location, for "near
me" features. It exposes `status`, `permission`, `coords`, `locate()` and
`refreshPermission()`.

- **Nothing is read until the app calls `locate()` from a user gesture.** Each
  call is one `getCurrentPosition`. It never watches or polls, and it never
  sends a coordinate anywhere.
- **Server rendering is a no-op.** On mount, the composable asks the Permissions
  API what the answer already is. That never prompts.
- **Four failure outcomes stay separate:**
  - `denied`: the person said no.
  - `blocked`: the page's own Permissions-Policy forbids geolocation, so the fix
    is the setting above. Chromium reports this as a denial, and the composable
    tells the two apart.
  - `unavailable`: no position could be had.
  - `timeout`: no position arrived in time.

It is not named `useGeolocation`, because VueUse's composable of that name
watches continuously.

narduk-core enables Nuxt UI color mode and defaults `@nuxtjs/color-mode` to
`preference: system` (or `NUXT_COLOR_MODE_PREFERENCE`), `fallback: 'dark'`, and
`classSuffix: ''`. The empty suffix is required so the document class is `dark`,
which is what Tailwind v4 and Nuxt UI 4 key on. Apps with no dark styling will
start rendering Nuxt UI chrome dark for dark-preference users on adoption; an
app that wants light-only sets
`colorMode: { preference: 'light', fallback: 'light' }` (Buoys does). An app can
still override `classSuffix`.

narduk-core seeds a local-only `@nuxt/icon` contract before it installs
`@nuxt/ui`: `provider: 'server'`, `fallbackToApi: false`, the Lucide collection
bundled on the server, and the icons core's own components render bundled on the
client. `@nuxt/icon` reads that contract once, when it installs. So **list
`@narduk-enterprises/narduk-core` before `@nuxt/icon`** in `modules`, as
generated apps do. An app that lists `@nuxt/icon` first keeps the Iconify API
fallback, and an enforcing CSP then refuses the first unbundled icon's fetch
from `api.iconify.design`. The build warns in that case, unless the app sets
`icon.fallbackToApi: false` itself (narduk-libs#467).

## Session module (`nuxt-auth-utils`)

`coreModules` still installs
[`nuxt-auth-utils`](https://github.com/atinux/nuxt-auth-utils) by default so
dashboard chrome can keep `useUserSession`. A site with no accounts can opt out:

```ts
export default defineNuxtConfig({
  nardukCore: {
    auth: false,
  },
})
```

`nardukCore.auth` defaults to `true`. `false` skips
`installModule('nuxt-auth-utils')` and does not seed
`runtimeConfig.session.password` from `NUXT_SESSION_PASSWORD || ''`, so
`/api/_auth/session` is not registered (narduk-libs#169). An app-owned
`runtimeConfig.session` is left alone.

With `app` on, the dashboard layout's `LayerDashboardShell` and
`LayerDashboardAccountMenu` still call `useUserSession`. Under `auth: false`
core registers a signed-out `useUserSession` in its place: `loggedIn` is
`false`, `user` and `session` are `null`, `ready` is `true`, and `fetch`,
`clear` and `openInPopup` do nothing. It has the same return shape as
`nuxt-auth-utils`' composable. An app that lists `nuxt-auth-utils` in its own
`modules` keeps the real one.

`auth: false` cannot be combined with `@narduk-enterprises/narduk-auth`: its
sessions live in `nuxt-auth-utils`, which it relies on core to install. The
build stops with a message naming the conflict, unless the app lists
`nuxt-auth-utils` in `modules` itself.

When auth stays on, the session plugin fetches `/api/_auth/session` during every
SSR, and with no `NUXT_SESSION_PASSWORD` that request throws (narduk-libs#540).
The install reuses the module's own `auth.loadStrategy` option:

- **`'none'`** when the app has not configured auth, so SSR makes no session
  call and logs no error. A published-data app (Buoys) is this case.
- **The default (`'server-first'`)** when an existing signal says the app uses
  auth: `NUXT_SESSION_PASSWORD` or `SESSION_PASSWORD` is non-empty at build
  time, `runtimeConfig.session.password` is already set, or the app lists
  `@narduk-enterprises/narduk-auth` or `nuxt-auth-utils` in `modules`.
- **Unchanged** when the app already set `auth.loadStrategy`.

`loadStrategy: 'none'` is not a substitute for `nardukCore.auth: false`: the
session module is still installed and still serves the session route.

## Public runtime overlay (Workers Builds)

Workers Builds runs `nuxt build` in a process that **does not** receive
`wrangler.json` / `wrangler.jsonc` `vars`. `process.env.GA_MEASUREMENT_ID || ''`
(and the same pattern for `POSTHOG_PUBLIC_KEY`, `NUXT_PUBLIC_ALLOW_GEOLOCATION`,
and other public keys) therefore bakes an empty string into the Worker artifact.
Nuxt then serializes that bake into the homepage `__NUXT__` payload. The live
Worker still has the bindings, so `GET /api/runtime/public` looks healthy while
the HTML payload looks intentionally dark (buoys#133).

That is a platform bug, not an app-local one. The long-term fix is **not**
reading `wrangler.json` from `nuxt.config.ts`.

narduk-core owns the request-time contract:

1. `resolveRuntimePublicOverlay(event)` reads live Worker bindings (short names
   such as `GA_MEASUREMENT_ID` / `POSTHOG_PUBLIC_KEY`, plus optional
   `NUXT_PUBLIC_*` aliases that Nuxt's own env overlay understands).
2. `applyRuntimePublicOverlay(event)` copies the browser-only part of that
   overlay (`RUNTIME_PUBLIC_SSR_KEYS`: the analytics keys and PostHog flags,
   `allowGeolocation`, `twitterSite`, `seoSearchActionUrlTemplate`) onto
   `useRuntimeConfig(event).public`. Nitro hands every request its own clone of
   that object, so nothing crosses requests in an isolate.
3. The `00-runtime-public` Nitro plugin runs that apply on every page request
   (everything outside `/api/` and `/_nuxt/`) **before SSR**, so `__NUXT__`
   matches the Worker env, crawlers included.
4. `GET /api/runtime/public` returns the whole overlay. The client plugin
   `runtime-public` still fetches it before the app mounts and applies all of
   it, including the keys SSR leaves alone.

SSR deliberately leaves `previewSafeMode`, `deploymentTarget`, `appUrl` /
`siteUrl` and the `auth*` / `supabase*` keys at their build values. Server code
in the same request reads them from the same object: the production 5xx
sanitizer keys off `previewSafeMode`, which the overlay turns on for a
production version reached through its `workers.dev` alias, and narduk-auth
reads the auth keys. The overlay never carries narduk-analytics'
`analyticsPrivacy`, so a strict app stays strict.

Preview aliases (`*.workers.dev` / `*.pages.dev` that are not the canonical
host) still blank analytics via the overlay. An empty string after the overlay
means the Worker does not have the key — turn collection off with
`analyticsLoadStrategy: 'off'` or by removing the var, not by baking `''`.

### What apps should do

Keep the short public names in `wrangler.json` `vars`. Do not duplicate them as
`NUXT_PUBLIC_*` aliases unless you want Nuxt's native overlay as well; both
shapes work. Do not add a build-time `readFileSync('wrangler.json')` helper.

After this package is published, an app that added that helper (Buoys PR #136)
can delete it, drop the `NUXT_PUBLIC_GA_MEASUREMENT_ID` /
`NUXT_PUBLIC_POSTHOG_PUBLIC_KEY` wrangler copies, and leave
`runtimeConfig.public.gaMeasurementId` / `posthogPublicKey` unset or empty at
build time. The Nitro plugin fills them on the Worker.

`NUXT_PUBLIC_ALLOW_GEOLOCATION` is the same class for **build-time**
nuxt-security / Permissions-Policy configuration. Request-time headers already
read the Worker binding through `readRuntimeBoolean`. Prefer that path over
baking a wrangler default into `nuxt.config.ts`.

## Security headers (`security.headers`)

narduk-core has always set security headers.
`runtime/server/middleware/securityHeaders.ts` is registered by
`addServerScanDir` whenever the module's default `server: true` is in effect, so
every app on this module already serves an enforcing Content-Security-Policy,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and
`X-Content-Type-Options`. What that legacy policy is missing is the part that
makes a CSP worth having:

- no `Strict-Transport-Security` at all;
- `script-src` carries `'unsafe-inline' 'unsafe-eval'`, so an injected inline
  script is allowed by the very header meant to stop it;
- no report-only mode and nowhere for violations to go;
- per-app origins expressible only through `CSP_*_SRC` environment variables;
- no `form-action` and no `upgrade-insecure-requests`.

`security.headers` closes exactly those gaps. It wraps
[`nuxt-security`](https://github.com/Baroshem/nuxt-security) (MIT) rather than
reimplementing a header stack: it is maintained, targets Nuxt 4 through
`@nuxt/kit ^4`, and its runtime imports no Node builtin — `crypto.subtle`,
`crypto.getRandomValues`, `btoa` and `TextEncoder` are all workerd APIs.
nuxt-security is an **optional peer dependency**, so an app that never enables
the preset installs nothing extra.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  nardukCore: {
    security: {
      headers: {
        enabled: true,
        allow: {
          script: ['https://p.nard.uk'],
          connect: ['https://p.nard.uk', 'https://api.iconify.design'],
          img: ['https://tiles.example'],
        },
      },
    },
  },
})
```

### Three modes, and why the default is "change nothing"

| `security.headers`                 | What is served                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| omitted or `false`                 | Exactly today's headers. Upgrading narduk-core changes nothing.                                                                                                                                                                                                                       |
| `{ enabled: true }`                | The legacy enforcing CSP **keeps being served**, and the strict nonce policy is served beside it as `Content-Security-Policy-Report-Only` (without `upgrade-insecure-requests`, which browsers ignore in report-only). Every other header comes from nuxt-security, and HSTS appears. |
| `{ enabled: true, enforce: true }` | The strict nonce policy becomes the enforcing `Content-Security-Policy` and the legacy one is retired.                                                                                                                                                                                |

Both literal readings of "opt-in, report-only first" would have been regressions
here. Making the headers opt-in would strip headers from every app that has them
today, and starting an already-enforcing app in report-only would downgrade a
live policy. Serving the two policies side by side during the soak avoids both:
a browser enforces the `Content-Security-Policy` it is given and only _reports_
on the `-Report-Only` one, so the soak cannot break a page.

### The adoption path

1. **Turn it on.** Set `security.headers.enabled` and deploy. Nothing a user can
   see changes; the app now also serves HSTS and a report-only strict policy.
2. **Soak, and read the violations.** Every violation is logged through
   narduk-logging at `warn` from the report route (`/api/_security/csp-report`
   by default). They go nowhere else — a report body carries the document URI
   and, for an inline violation, a sample of the offending source, and shipping
   that to a third-party collector is a data-egress decision nobody made. Change
   the path with `reportRoute`, or set `reportRoute: false` to serve no route
   and emit no `report-uri`. The route reads only `application/csp-report` and
   `application/reports+json` bodies (anything else is answered 204 unread) and
   allows each client 60 reports a minute under the rate-limit key `csp-report`,
   which `runtimeConfig.nardukRateLimit.routes` can raise.
3. **Fix what it found**, usually by adding the origin to `allow`. A week of
   real traffic across the routes that matter is a reasonable soak; a quiet
   route proves nothing about a busy one.
4. **Enforce.** Set `enforce: true` and deploy. From here the legacy CSP is gone
   and the strict policy is the one in force.

Prove the deployment at any step with
`narduk-app foundation:check:security-headers --base-url https://your.app`,
which reads the live response headers and reports each one proven, a gap, or
unknown.

### Options

| Option              | Default                                                                        | Notes                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`           | `false`                                                                        | Serve the strict policy at all.                                                                                                                                               |
| `enforce`           | `false`                                                                        | Promote it from report-only to enforcing.                                                                                                                                     |
| `allow`             | baseline only                                                                  | Extra origins per directive: `script`, `connect`, `img`, `font`, `style`, `frame`, `worker`, `media`. Merged onto the selected baseline, never replacing it.                  |
| `baseline`          | `'estate'`                                                                     | `'self'` skips the whole estate allowlist — third-party hosts **and** `data:` on `img-src`, `blob:` on `worker-src`. Each directive becomes `'self'` plus this app's `allow`. |
| `strictDynamic`     | `true`                                                                         | Keep `'strict-dynamic'` in `script-src`. See the warning below.                                                                                                               |
| `hsts`              | 180 days, `includeSubdomains`, no preload                                      | `false` disables it. `preload` is never defaulted on, because submitting to the preload list is irreversible in practice.                                                     |
| `frameAncestors`    | `["'none'"]`                                                                   | Also drives the `X-Frame-Options` fallback, which can only express `DENY` and `SAMEORIGIN`.                                                                                   |
| `referrerPolicy`    | `strict-origin-when-cross-origin`                                              |                                                                                                                                                                               |
| `permissionsPolicy` | camera, microphone, geolocation, payment, usb and `interest-cohort` all denied | Merged onto the baseline, so granting one does not restate the rest.                                                                                                          |
| `reportRoute`       | `/api/_security/csp-report`                                                    | `false` serves no route and emits no `report-uri`.                                                                                                                            |

An app that already sets `CSP_SCRIPT_SRC`, `CSP_CONNECT_SRC`, `CSP_FRAME_SRC`,
`CSP_WORKER_SRC` or `CSP_MEDIA_SRC` keeps those origins: they are folded into
the preset's allowlist, so turning the preset on does not quietly drop them.
They are the app's own origins, so `baseline: 'self'` keeps them too.

#### `baseline: 'self'`

The estate baseline is a floor, and a floor is the wrong shape for an app that
reaches no third party. Because `allow` can only add, such an app could not
enforce the strict nonce policy without **widening** its CSP: it would trade
`script-src 'unsafe-inline'` for the eleven origins in `BASELINE_ALLOWLIST`,
eight of them on `connect-src` — the directive that governs where a page may
send data.

```ts
nardukCore: {
  security: {
    headers: { enabled: true, enforce: true, baseline: 'self' },
  },
}
```

Everything else is unchanged: the nonce, `'strict-dynamic'`, HSTS,
`frame-ancestors`, `form-action`, `object-src 'none'`, the report route, and
style-src's `'unsafe-inline'` (which is Vue's scoped-style runtime, not a
baseline origin). The resulting policy is a strict subset of the `'estate'` one
— a test pins that.

Reach for it only when the app genuinely contacts nothing third-party. An app
that installs narduk-analytics or narduk-mapkit wants the default, or it will be
restating those modules' hosts in `allow` by hand.

> [!WARNING] `'strict-dynamic'` makes a conforming browser **ignore every host**
> in `script-src`, `'self'` included, and trust only scripts created by already-
> trusted script. That is what makes a nonce policy strong, and it is also why a
> script injected into the HTML _after_ Nitro responds — Cloudflare's Web
> Analytics beacon, added by the edge HTML rewriter, is the estate's real case —
> is not covered by listing its host. The report-only soak is where that gets
> decided from evidence; `strictDynamic: false` falls back to host allowlisting.

`style-src` keeps `'unsafe-inline'`. A nonce applies to elements, never to a
`style="…"` attribute, and Vue's scoped-style runtime writes those constantly.
It is the accepted cost of a nonce policy on a Vue app and does not weaken
`script-src`, which is where injection actually lands.

### Proving the nonce

`scripts/prove-nonce.mjs` builds `tests/fixtures/nonce-app` with the strict
policy **enforcing**, serves it on workerd through `wrangler dev --local`, and
asserts that the CSP carries a real per-request nonce, that every script tag
including Nuxt's inline `__NUXT_DATA__` hydration payload is stamped with it,
that two requests get two different nonces, and that Chromium logs no CSP
violation while the page hydrates. It is not part of `test:unit` — it needs a
full Nitro build and a browser binary — so run it by hand when the preset, the
Nuxt major, or the nuxt-security version moves.
`tests/nuxt-security-contract.test.ts` is the cheap tripwire that runs in CI
instead.

## Adding a row to the footer

`LayerAppFooter` renders an `after` slot below its content. By default the slot
renders every global component named in `appConfig.nardukCore.footer.after`, in
order. A module adds its own row by registering a global component and appending
its name there, instead of shipping a copy of the footer (narduk-libs#743). An
app can pass its own `#after` slot to replace the listed rows.

```ts
// app.config.ts
export default defineAppConfig({
  nardukCore: { footer: { after: ['MyFooterRow'] } },
})
```

## Error page and exception capture

Both ship with the module. An app that pins narduk-core gets them with no file
of its own — no `error.vue`, no error listeners, no configuration.

### The error page

The module sets Nuxt's `app.errorComponent` from the `app:resolve` hook. Nuxt's
own `resolveApp()` assigns that field just before calling the hook: an
`app/error.*` from the project or any layer when one exists, and otherwise
Nuxt's built-in `nuxt-error-page.vue`. The module replaces **only** the
built-in, so an app-owned error page still wins and nothing has to be copied
into a repository or managed by a codemod. Apps install this package as a module
rather than a layer, which is why the layer-directory path Nuxt scans never
reaches `runtime/app/error.vue` on its own.

The page shows the status code with plain-language copy for the outcome (404,
403, 401, 429, 503, and a fallback), a **Go Home** action (`clearError`), a
**Try Again** action (`reloadNuxtApp`), `robots: noindex, nofollow`, and the
**request id**.

The request id is the value `x-request-id` carries and the one every
narduk-logging server record is keyed by, so a user reading it off the page
hands support the key that finds the log line. It is resolved during SSR from
`event.context._requestId` and transferred through the Nuxt payload
(`useRequestId()`), because a browser cannot read the response header of the
document it is running in. The `requestLogger` middleware also echoes the id
back onto the incoming request headers, so a re-entrant render of the failed
page adopts the same id instead of minting a new one.

The raw error message appears only where `previewSafeMode` is on — preview,
staging, and any deployment an operator has explicitly marked non-production.
Production traffic sees the status-code copy and nothing else.

E2E selectors: `error-page`, `error-page-status`, `error-page-title`,
`error-page-description`, `error-page-request-id`, `error-page-home`,
`error-page-retry`, `error-page-detail`.

To override the page, add `app/error.vue` to the app. To keep this page and wrap
it, re-export it:

```vue
<script setup lang="ts">
export { default } from '@narduk-enterprises/narduk-core/app/error-page'
</script>
```

The `./app/error-page` export carries a `types` condition (narduk-libs#521): the
page is typed as a component taking `error: NuxtError`, so an app that imports
it into its own `app/error.vue` needs no `@ts-expect-error`:

```vue
<script setup lang="ts">
import EstateErrorPage from '@narduk-enterprises/narduk-core/app/error-page'
import type { NuxtError } from '#app'

defineProps<{ error: NuxtError }>()
</script>

<template>
  <EstateErrorPage :error="error" />
</template>
```

### Exception capture

One seam, `narduk:exception`, carried on the runtime's own hook bus. Three
capture sites feed it and never talk to a reporter directly, so adding a
destination never means adding a second capture path:

| Site                | Hook                 | Fatal    |
| ------------------- | -------------------- | -------- |
| Vue component error | `vue:error` (client) | no       |
| Fatal app error     | `app:error` (client) | yes      |
| Any Nitro error     | `error` (server)     | 5xx only |

One report per error. `vue:error` and `app:error` both fire when a component
failure is escalated to the app error boundary, and Nitro can announce one
handled error twice; both are deduplicated.

Each report carries the route **pattern** (`/stations/:id`, never a raw path, so
record ids and slugs stay out of it), the build version, the request id, the
status code, and a message with query strings and email addresses redacted.

**Nothing here logs.** narduk-logging's `installNitroLogging` already writes
exactly one record per failing request — including 4xx and unrouted paths since
narduk-libs#359 — so a record written by the capture plugin would double every
server error. Server log records now also carry `buildVersion`.

Subscribe a destination:

```ts
import { onNardukException } from '@narduk-enterprises/narduk-core/shared/exception-report'
import { defineNuxtPlugin } from '#imports'

export default defineNuxtPlugin({
  name: 'app-exception-reporter',
  setup(nuxtApp) {
    onNardukException(nuxtApp as never, (report) => {
      // report.route, report.requestId, report.statusCode, report.buildVersion
    })
  },
})
```

`@narduk-enterprises/narduk-analytics` registers the PostHog reporter for client
exceptions; see its README. When a reporter throws, the error being reported is
not escalated.

Operational guide:
[an error page is showing / exceptions are spiking](../../../docs/operations/error-page-and-exceptions.md).

## Tailwind sources and Nuxt UI component detection

Nuxt UI adds an `@source` and scans for `U*` components only in Nuxt _layers_.
narduk-core is a module installed under `node_modules`, so it registers its own
files (narduk-libs#700):

- `main.css` carries `@source '../../'`, so the utilities core's `runtime/app`
  files use (the error page's `text-7xl` and `min-h-screen`, the header's
  `md:flex`) are generated in an app that never names them.
- When an app turns on `ui.experimental.componentDetection`, core adds the Nuxt
  UI components its own files render (`src/nuxt-ui-components.ts`; `UButton` on
  the error page, the `UDashboard*` set for the `dashboard` layout) to the
  detection list. `true` becomes that list, which Nuxt UI still treats as
  "detect, and always include these". An app lists only its own components.

Another module does the same with `registerNuxtUiSources` from
`@narduk-enterprises/narduk-core/nuxt-ui-sources`. Given `sources` (absolute
directories) and `components`, it prepends an `@source` per directory to Nuxt
UI's `ui.css` and extends the detection list, once every module is installed.
narduk-auth uses it for its `app/` directory.

## Shared-secret guard

`@narduk-enterprises/narduk-core/server/utils/shared-secret` checks a static
secret on an inbound request (an ingest token, a scheduler secret, a diagnostics
key) in constant time (narduk-libs#979). `requireCronAuth` is a wrapper over it
for `CRON_SECRET`.

```ts
import { requireSharedSecret } from '@narduk-enterprises/narduk-core/server/utils/shared-secret'

requireSharedSecret(event, {
  secretKey: 'RECAP_INGEST_TOKEN',
  fallback: useRuntimeConfig(event).recapIngestToken,
  unsetStatus: 503,
})
```

- `secretKey` is read with `readRuntimeString`, so a Worker env binding wins
  over `fallback`.
- `header` defaults to `authorization`, where a case-insensitive `Bearer` scheme
  is stripped. Any other header is read raw.
- An unset secret passes in dev and fails closed elsewhere with `unsetStatus`
  (default 500). A mismatch answers `rejectStatus` (default 401) with
  `rejectMessage`.
- `hasSharedSecret(event, options)` never throws and is `false` whenever the
  secret is unset, for "session OR token" guards:
  `hasSharedSecret(event, options) || (await requireAdmin(event))`.
- `timingSafeEqualText(a, b)` is the byte-wise compare underneath.

## Media security policy

Media stays restricted to the application origin by default. Set
`runtimeConfig.public.cspMediaSrc` (or `CSP_MEDIA_SRC` at build time /
`NUXT_PUBLIC_CSP_MEDIA_SRC` at runtime) to a comma-separated list of additional
sources, such as `blob:,https://media.example.com`. Browser MSE players
typically need `blob:` here and the media origin in `cspConnectSrc` for manifest
and segment fetches; native HLS needs the media origin in `cspMediaSrc`. These
options extend only their named directives and leave scripts, frames, and
workers unchanged.

## Canonical host redirect

`server/middleware/00-canonical-host` sends a request that arrives on a
non-canonical hostname to the canonical origin with a `308`. The 308 is sent
`private, no-store` with `Vary: Sec-Fetch-Dest`. It is off unless
`ENFORCE_CANONICAL_HOST` or `AUTH_ENFORCE_CANONICAL_HOST` is set (env or
`runtimeConfig.public`), takes the canonical origin from `SITE_URL` falling back
to `runtimeConfig.public.appUrl`, and disables itself when that origin is not
`https:` or is localhost. It reads the `host` header only — never
`x-forwarded-host`, which a client can set to bypass the redirect.

`ENFORCE_CANONICAL_HOST` redirects **every** non-canonical host, which includes
`*.workers.dev` previews and the production `workers.dev` alias a live proof
curls for a 200. To redirect only duplicate hosts such as `www`, name them
instead: `CANONICAL_REDIRECT_HOSTS=www.example.com` (env, comma-separated) or
`runtimeConfig.public.canonicalRedirectHosts` (a string or a list). A named list
turns the redirect on without `ENFORCE_CANONICAL_HOST`, and when set it is the
whole rule: only the named hosts redirect, every other host is served where it
was asked, and a `*.workers.dev` entry is ignored (narduk-libs#515). The
navigation-only rule below applies either way.

**It redirects top-level document navigations only.** Canonicalisation is worth
something on a navigation: search engines, bookmarks, and an auth cookie that
has to be set on the canonical host. On a `fetch()` or a sub-resource it is only
harmful — the browser follows the `308` cross-origin, the response carries no
`Access-Control-Allow-Origin`, the call fails, and the canonical host has
already run the handler and paid whatever that route costs. This broke
same-origin API calls on every preview hostname (`*.workers.dev`, per-version
preview URLs, branch aliases) until narduk-libs#408.

The rule, in order:

| request                                                                 | redirected?                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| `Sec-Fetch-Dest: document` (any path)                                   | yes                                               |
| `Sec-Fetch-Dest` present, anything else (`empty`, `script`, `image`, …) | no                                                |
| no fetch metadata, page path                                            | yes — crawlers and old clients still canonicalise |
| no fetch metadata, `/api/**` or `/_**`                                  | no                                                |
| `POST`/`PUT`/`PATCH`/`DELETE`                                           | no (safe methods only)                            |

Because the first row is keyed on the navigation and not on the path, an auth
route that the browser navigates to — `/auth/callback`, `/auth/confirm`, or a
`GET /api/auth/session/exchange` a provider redirects into — still canonicalises
before it sets its cookie. The one behaviour change beyond the fix: a client
that sends no `Sec-Fetch-*` headers at all (curl, server-to-server, Safari
before 16.4) is no longer redirected on `/api/**`, so an auth navigation from
such a client would set its cookie on the hostname it arrived at. Providers are
sent to `appUrl`-derived URLs, which are already canonical, so this is the
fallback path rather than the flow.

`server/middleware/canonicalRedirect` was a second, auto-registered
canonical-host middleware that redirected with `301` and gated on
`import.meta.dev` instead (narduk-libs#409). It has been removed from the
middleware tree; the import path still resolves, as a deprecated alias for the
live handler, for apps that run the middleware chain by hand.

## Database backend

Every app states whether it has a database with the `databaseBackend` module
option:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-core'],
  nardukCore: { databaseBackend: 'none' },
})
```

| Value        | The app uses                                 |
| ------------ | -------------------------------------------- |
| `'d1'`       | Cloudflare D1 through the `DB` binding       |
| `'postgres'` | PostgreSQL through the Hyperdrive binding    |
| `'none'`     | No database: a publication-only or proxy app |

Without the option, core reads `NUXT_DATABASE_BACKEND` at build time. An app
that sets neither still gets D1, but it has not declared it, and
[`/api/health`](#health-endpoint) treats a missing D1 binding as `degraded`
rather than as an error. An unknown option value fails the build; an unknown
`NUXT_DATABASE_BACKEND` value is ignored with a warning.

On D1, `useDatabase(event)` and `createAppDatabase` accessors count every call
into the binding on narduk-logging's request counter (narduk-libs#511): one
round trip per `first` / `all` / `run` / `raw` on a prepared statement, and one
round trip carrying every statement for a `batch`. The counts reach the
`Server-Timing` header (when phases are exposed) and the "Request completed" log
record. Counting never fails a query.

With `'none'`:

- `useDatabase(event)` and accessors made by `createAppDatabase` throw an HTTP
  500 that names the declaration.
- A bearer API key authenticates nobody: `authenticateApiKey` returns `null`.
- `/api/health` reports `database: "not_applicable"` and probes nothing.
- The build fails if `@narduk-enterprises/narduk-auth` is installed, because
  sign-in stores users, sessions and API keys in the app database.

### Atomic batches on D1 and better-sqlite3

`runAtomicBatch(db, statements)` (auto-imported in server code, or
`@narduk-enterprises/narduk-core/server/utils/atomic-batch`) runs a group of
writes as one transaction on either driver an app's database runs on, so the
same code works in the Worker and under vitest against the merged migrations:
D1's `db.batch(statements)`, or every statement's `.all()` inside
better-sqlite3's `db.$client.transaction`. Any other database is refused rather
than run statement by statement, because a half-applied batch is the failure it
exists to prevent.

Under better-sqlite3 every statement must return rows, so give writes a
`.returning(...)`; otherwise the driver throws "This statement does not return
data" (narduk-libs#201).

```ts
await runAtomicBatch(db, [
  db.insert(frames).values(frame).returning({ id: frames.id }),
  db
    .insert(latest)
    .values(row)
    .onConflictDoUpdate({ target: latest.vesselId, set: row })
    .returning(),
])
```

## Health endpoint

Core serves `GET /api/health` for uptime monitors and deploy checks. The
response is never cached (`Cache-Control: no-store`).

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-09-16T17:00:00.000Z",
    "database": "not_applicable",
    "missingAuthTables": [],
    "checks": [
      {
        "name": "database",
        "required": false,
        "result": "skipped",
        "reason": "not-configured"
      },
      {
        "name": "auth-tables",
        "required": false,
        "result": "skipped",
        "reason": "auth-not-enabled"
      },
      {
        "name": "publication",
        "required": true,
        "result": "pass",
        "durationMs": 4,
        "detail": { "releaseId": "2026-09-16.1" }
      }
    ]
  }
}
```

| `status`   | HTTP | Meaning                           |
| ---------- | ---- | --------------------------------- |
| `ok`       | 200  | Every check passed or was skipped |
| `degraded` | 200  | An optional check failed          |
| `error`    | 503  | A required check failed           |

A failure reported at `notice` severity (below) is published with `notice: true`
and does not move `status`.

`database` summarizes the built-in probe:

| `database`       | Meaning                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ok`             | The probe passed                                                                                                        |
| `not_applicable` | The app declared `databaseBackend: 'none'`                                                                              |
| `not_available`  | No D1 `DB` binding: `error` for an app that declared its backend, `degraded` for one that only inherited the D1 default |
| `schema_error`   | A narduk-auth table is missing (`degraded`); `missingAuthTables` names it                                               |
| `error`          | The probe failed or took longer than 5 seconds                                                                          |

`checks` lists every check as `{ name, required, result }`, where `result` is
`pass`, `fail` or `skipped`, with `reason` for a skipped check, `error` for a
failed one, `kind` for a check built by a core helper, and `durationMs` and
`detail` when present. The first two entries are built in:

- `database` runs `SELECT 1` against D1, or `select 1` through Hyperdrive.
- `auth-tables` runs only when narduk-auth is installed on D1. It looks up the
  `users`, `sessions` and `api_keys` tables, which also proves the connection,
  and it is optional.

Registered checks follow, in registration order.

### Registering a check

`registerHealthCheck` is auto-imported in server code, or import it from
`@narduk-enterprises/narduk-core/server/utils/health-checks`. Register from a
Nitro plugin so the check exists before the first request:

```ts
// server/plugins/health-checks.ts
export default defineNitroPlugin(() => {
  registerHealthCheck({
    name: 'publication',
    required: true,
    timeoutMs: 2000,
    async run({ signal }) {
      const manifest = await readPublishedManifest({ signal })
      return { detail: { releaseId: manifest.releaseId } }
    },
  })
})
```

- `name`: 1-63 lowercase letters, digits or hyphens. `database` and
  `auth-tables` are reserved. Registering a name again replaces the earlier
  check, and `registerHealthCheck` returns a function that removes it.
- `required`: a failed required check makes the report `error` (HTTP 503); a
  failed optional check makes it `degraded`. On a failing entry, `required` is
  that failure's own rollup contribution, which matters only for a check that
  can fail at more than one severity — see
  [freshness checks](#reporting-data-freshness) below.
- `timeoutMs`: defaults to 3000 and may be at most 30000. A check that runs out
  of time fails, and its `signal` is aborted.
- `run`: resolve to pass; throw or return `{ ok: false }` to fail. Return
  `{ ok: false, severity: 'notice' }` to publish a failure that is worth showing
  but not worth a page: the entry says `result: 'fail'` with `notice: true` and
  its `detail`, and the report's `status` stays where the other checks put it
  (narduk-libs#414). Checks run concurrently with each other and with the
  database probe.
- `detail`: an optional JSON object published with the result. It is left out,
  with `detailOmitted` saying why, when it is not a plain object, cannot be
  serialized, is larger than 1 KiB, or has a `status` or `database` key at any
  depth.

A failed check publishes fixed text such as `Check failed.`; the thrown error
goes only to the server log.

### Reporting data freshness

An app that serves published data is up long after its feed has gone stale. A
plain `registerHealthCheck` cannot say so without a choice between silence and a
503, so core ships the freshness check as its own helper.
`registerFreshnessCheck` is auto-imported in server code, or import it from
`@narduk-enterprises/narduk-core/server/utils/freshness-checks`:

```ts
// server/plugins/health-checks.ts
export default defineNitroPlugin(() => {
  registerFreshnessCheck({
    name: 'observations-freshness',
    source: 'ndbc-realtime-observations',
    warnAfter: 45 * 60,
    failAfter: 6 * 60 * 60,
    timeoutMs: 30_000,
    async read({ signal }) {
      const { product } = await readPublishedProduct({ signal })
      return {
        at: product.freshness.asOf,
        detail: { releaseId: product.releaseId },
      }
    },
  })
})
```

Each registration adds one entry to `checks`:

```json
{
  "kind": "freshness",
  "name": "observations-freshness",
  "required": false,
  "result": "fail",
  "durationMs": 12,
  "detail": {
    "releaseId": "2026-09-16.1",
    "source": "ndbc-realtime-observations",
    "warnAfterSeconds": 2700,
    "failAfterSeconds": 21600,
    "observedAt": "2026-09-16T13:10:00.000Z",
    "ageSeconds": 3000,
    "reason": "stale"
  }
}
```

- `name` and `timeoutMs` follow the rules above; `kind` is always the literal
  `freshness`, so a detector can select every freshness entry across apps
  without knowing app-chosen names.
- `source`: which upstream feed this check watches, 1-128 characters. Register
  one check per feed.
- `read`: resolve to `{ at, detail? }`. `at` is a `Date`, an ISO 8601 string or
  epoch **milliseconds**; the optional `detail` is published underneath the
  computed fields.
- `warnAfter` / `failAfter`: ages in **seconds**, at most one year. `failAfter`
  must be at least `warnAfter` and may be omitted.
- `noticeAfter`: optional, in seconds, at most `warnAfter`. The first band of a
  producer's fresh / aging / stale policy: past it the entry fails as a notice
  and nothing pages.
- `now`: an epoch-millisecond clock, for tests. Defaults to `Date.now`.

| Data age                               | `result`                | `required`  | Report     | HTTP |
| -------------------------------------- | ----------------------- | ----------- | ---------- | ---- |
| at most `noticeAfter` (or `warnAfter`) | `pass`                  | as declared | unchanged  | 200  |
| past `noticeAfter`                     | `fail` + `notice: true` | `false`     | unchanged  | 200  |
| past `warnAfter`                       | `fail`                  | `false`     | `degraded` | 200  |
| past `failAfter`                       | `fail`                  | `true`      | `error`    | 503  |

A stale feed therefore makes the report `degraded` and answers 503 only once
`failAfter` is crossed; a check registered without `failAfter` can never get
there. `degraded` still pages a monitor that matches `"status":"ok"` (see
below), so `warnAfter` is the age that deserves a page and `noticeAfter` the one
that only deserves a mark on a dashboard. `observedAt` and `ageSeconds` are
published while the check is passing too, so a dashboard can plot age before
anything is wrong. A timestamp in the future is never stale — a producer clock
ahead of the Worker shows up as a negative `ageSeconds`.

A freshness check **fails closed**. No timestamp, an unparseable one, a `read`
that throws, and a `read` that runs out of time all fail at the strongest
severity the thresholds allow, never pass, and say which in `detail.reason`
(`missing-timestamp`, `invalid-timestamp`, `unreadable`, or `stale`). The cause
of a thrown read goes to the server log only.

Under the hood a check that can fail at more than one severity returns
`{ ok: false, severity: 'degraded' }` (or `'notice'`) from `run`, which
publishes that entry's `required` as `false`, and `notice: true` for a notice. A
check declared `required: false` can never escalate itself to `error`, so the
rollup keeps reading a single field.

### Monitoring the endpoint

Prefer the HTTP status where a monitor supports it. A monitor that matches a
substring can rely on `"status":"ok"`: `status`, `timestamp` and `database` are
the first fields of `data`, well inside the first 4096 bytes, and no check
detail can contain a `status` or `database` key.

## CSRF protection

The server middleware refuses a `POST`/`PUT`/`PATCH`/`DELETE` that carries no
`X-Requested-With` header with a 403. Browsers do not let a cross-site page set
a custom header, so this stops form-based CSRF; the layer's client fetch plugin,
`useAppFetch()` and `useCsrfFetch()` add the header for the app's own calls. It
is skipped for `/api/webhooks/`, `/api/cron/`, `/api/callbacks/`, `/api/_auth/`,
`/__nuxt_content/`, `/api/owner-tag`, `Authorization: Bearer nk_…` API keys, and
the `security.headers` CSP report route (browsers deliver reports without the
header).

### Declaring a credential-free route

A route that carries **no ambient credential** — a device that calls before it
has any account, session or cookie — gains nothing from the check and cannot
satisfy it. Declare it in the module options rather than faking the header in an
app middleware:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  nardukCore: {
    csrf: {
      exemptPaths: [
        '/api/edge/v1/claim/start', // exact path
        '/api/edge/v1/claim/handoff',
        '/api/devices/*', // prefix
      ],
    },
  },
})
```

An entry is an exact path or a prefix ending in `/*`. The query string is
ignored and one trailing slash is tolerated; a request spelled with a percent
escape, an empty segment or a dot segment is never exempt. An entry covering the
whole site or the whole `/api` tree, a prefix with fewer than two segments, or
one containing a query, fragment, escape or wildcard elsewhere **fails the
build**. The runtime key is `runtimeConfig.nardukCsrf.exemptPaths`, and the
middleware re-checks it on every request, so an env override cannot widen the
exemption past that grammar.

> [!WARNING] Exempting a route a signed-in browser also calls re-opens CSRF on
> it. Keep the session-bearing leg out of the list — in the example,
> `/api/edge/v1/claim/complete` rides the user's session and stays protected. An
> exempt route that reads a body must authenticate its caller another way.

## Per-route rate limits: `defineRateLimitedHandler`

Wrap a route handler and it is rate limited. The app declares the allowance; it
never writes a limiter, and it never edits a registry in this package.

```ts
// server/api/stations/index.get.ts — auto-imported, like defineEventHandler
export default defineRateLimitedHandler(
  async (event) => listStations(getQuery(event)),
  { key: 'marine-public-api', limit: 120, windowSeconds: 60 },
)
```

`key` names the allowance — use a slug, not a path, because it is also the
`runtimeConfig` override key and the field in the denial log record.

| Option          | Default       | Meaning                                                                                                                           |
| --------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `key`           | required      | Stable identifier for this route's allowance.                                                                                     |
| `limit`         | `120`         | Requests permitted per window.                                                                                                    |
| `windowSeconds` | `60`          | Window length.                                                                                                                    |
| `scope`         | `'ip'`        | `'ip'` — one allowance per client address; `'ip-path'` — per address per path; `'global'` — one allowance shared by every caller. |
| `headers`       | `'both'`      | `'standard'`, `'legacy'`, `'both'` or `'none'` (see below).                                                                       |
| `binding`       | by convention | Explicit wrangler `ratelimits[].name`.                                                                                            |
| `enabled`       | `true`        | Turn the limit off without removing the wrapper.                                                                                  |

### What enforces the limit

Two layers run, and a denial from either answers 429.

1. **The Cloudflare Rate Limiting binding**, when the app declared a matching
   `ratelimits` entry. Its counters are coordinated per Cloudflare location
   rather than per isolate, so it is the more accurate enforcer and it runs
   first.
2. **An in-isolate fixed window**, always. On its own it permits roughly
   `limit x live isolates`, so it is a brute-force and scraper dampener rather
   than a quota. It runs regardless because it is the only source of the
   `RateLimit-*` quota headers — the binding's `.limit()` resolves to
   `{ success }` with no remaining count and no reset instant — the only path
   that supports a window other than 10 or 60 seconds, and the only one that
   exists in `nuxt dev`, in unit tests and under plain Node.

**The binding is an upgrade, never a prerequisite.** Cloudflare does not
document whether it is available on the Workers Free plan, so an app adopts this
helper with no wrangler change at all and can add the binding later without
touching a line of route code.

To enable it, declare the binding under the top-level `ratelimits` array (GA
since 2025-09-19; needs Wrangler >= 4.36.0) and name it `RL_<limit>` to match
the convention this package already uses, or pass `binding` explicitly:

```jsonc
// wrangler.json — Worker "riverstatus"
{
  "ratelimits": [
    {
      "name": "RL_120",
      // rateLimitNamespaceId('riverstatus', 120): prefix 32195 + limit 120
      "namespace_id": "32195120",
      "simple": { "limit": 120, "period": 60 },
    },
  ],
}
```

**`namespace_id` is unique per Cloudflare account, not per Worker.** Two
bindings with the same id share counters across every Worker on the account, so
never paste an id from an example or another app — the scaffold copies `1001`,
`50110`, `50121` and `50300` are already in use. Derive it from the Worker
`name` instead:

1. FNV-1a 32-bit over the UTF-8 Worker name, reduced to a five-digit prefix in
   `10000`–`49999`;
2. the binding's per-minute `limit`, padded to three digits, appended with no
   separator (so `RL_60` → `…060` and `RL_600` → `…600` cannot collide).

`rateLimitNamespaceId(workerName, limit)` from
`@narduk-enterprises/narduk-core/shared/rate-limit-namespace` computes it, and
`RATE_LIMIT_SCAFFOLD_NAMESPACE_IDS` lists the ids a check should refuse. Write
the prefix beside the bindings so the next binding the app adds follows it. An
app already on its own unique scheme (Buoys' `2869300` / `2869120`) keeps it.

Cloudflare's `period` accepts only `10` or `60` seconds, so a route with any
other `windowSeconds` is enforced by the in-isolate window alone and looks for
no binding. Cloudflare also describes these counters as "permissive, eventually
consistent, and intentionally designed to not be used as an accurate accounting
system", which is the other reason the local window is kept.

### Response headers

The IETF work is at
[draft-ietf-httpapi-ratelimit-headers-11](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers-11),
which defines `RateLimit-Policy` (the quota policy) and `RateLimit` (the quota
currently available) as Structured Fields — _not_ the familiar
`RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset` triad, which earlier
revisions specified and which is what public APIs actually ship. Both families
are emitted by default so neither kind of client is broken:

```http
RateLimit-Policy: "marine-public-api";q=120;w=60
RateLimit: "marine-public-api";r=119;t=60
RateLimit-Limit: 120
RateLimit-Remaining: 119
RateLimit-Reset: 60
```

Set `headers` to `'standard'` for the draft fields only, `'legacy'` for the
triad only, or `'none'` to publish nothing but `Retry-After`.

A denial answers **429** with `Retry-After`, `RateLimit-Remaining: 0`, the
request's `x-request-id` preserved so a client's report correlates to the server
record, and exactly one structured `warn` through
`@narduk-enterprises/narduk-logging` carrying `rateLimitKey`, `limit`,
`windowSeconds`, `scope`, `enforcedBy` and the **matched route template** — not
the raw path, which carries caller-chosen identifiers and query values.

### A route you cannot wrap: `consumeRateLimit`

Some routes belong to a module rather than the app: `narduk-mapkit`'s
`/api/mapkit-token`, for example, registered with `addServerHandler`. There is
no handler to wrap, and copying the route into the app would fork a
credential-minting endpoint. `consumeRateLimit(event, options, path?)` is the
wrapper's own decision step, exported (narduk-libs#413). It uses the same
counter key, window store, binding and `runtimeConfig.nardukRateLimit`
overrides, and logs a denial the same way, but it returns the verdict instead of
throwing and sets no headers:

```ts
// server/middleware/mapkit-token-rate-limit.ts
export default defineEventHandler((event) => {
  if (event.path !== '/api/mapkit-token') return
  event.context.nardukMapKit = {
    rateLimit: async () => {
      const { allowed, verdict } = await consumeRateLimit(event, {
        key: 'mapkit-token',
        limit: 60,
      })
      return allowed
        ? { allowed }
        : { allowed, retryAfterSeconds: verdict?.retryAfterSeconds }
    },
  }
})
```

Every call counts, so call it once per request. `verdict` is absent when nothing
was counted, because the policy is disabled or the path is exempt.

### What a caller is counted as

The `'ip'` and `'ip-path'` scopes key on the `cf-connecting-ip` address, with
one change: **an IPv6 caller is counted by its `/64`**. An IPv6 host is normally
handed a whole `/64`, and privacy extensions rotate the low half on their own,
so a full-address key would give one client a fresh window per address. IPv4 is
counted by the full address. Only the counter collapses — `getClientIp` still
returns the full address for audit rows and approximate location.
`enforceRateLimit` / `enforceRateLimitPolicy` count IPv6 the same way.

The limiter runs inside the handler, so no spelling the router dispatches to the
route escapes it: `/path/`, `/path?x=1` and a percent-encoded `/pa%74h` all
count in the bucket of `/path`, in the `'ip-path'` scope too. Do not put a
path-equality middleware in front of a route and call it a limiter — h3 keeps
the trailing slash on `event.path`, so `/path/` skips the middleware and still
reaches the route. Wrap the handler.

### Exemptions

These paths are never limited, whatever a route declares: `/api/health`,
`/favicon.ico`, `/robots.txt`, `/sitemap.xml`, `/sitemap_index.xml`,
`/sitemap/*`, `/__sitemap__/*`. A 429 on a health probe reads as an outage, and
a throttled crawler is an SEO self-injury. The query string is ignored, so a
monitor URL with a cache-buster stays exempt.

`runtimeConfig.nardukRateLimit.exemptPaths` **replaces** that list rather than
extending it; a trailing `*` matches by prefix, and an explicitly empty array
means "exempt nothing".

### Operator overrides

## Typed API contracts: `defineValidatedHandler`

Give a route a signature. The schemas are the contract: the handler receives
`query`, `params` and `body` already parsed and fully typed, and never touches
`getQuery`, `getRouterParam` or `readBody`.

```ts
// server/api/stations/[stationId]/history.get.ts — auto-imported
export default defineValidatedHandler({
  params: z.object({ stationId: z.string().min(1) }),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(2000).default(500),
    resolution: z.enum(['raw', 'hourly', 'daily']).default('raw'),
  }),
  handler: ({ params, query }) => readHistory(params.stationId, query),
})
```

A route declares only the parts it has. An undeclared part is `undefined` in the
handler and is never read — a route with no `body` schema never touches the
payload.

| Option             | Default           | Meaning                                                                      |
| ------------------ | ----------------- | ---------------------------------------------------------------------------- |
| `handler`          | required          | The route. Receives `{ body, event, params, query }`.                        |
| `query`            | —                 | Schema for `getQuery`: values arrive as strings, so `z.coerce` most numbers. |
| `params`           | —                 | Schema for the route params (`[stationId]`): always strings.                 |
| `body`             | —                 | Schema for the JSON body. Only read for `POST`, `PUT`, `PATCH`, `DELETE`.    |
| `response`         | —                 | Shape this route promises. **Checked, never used to reshape** — see below.   |
| `maxBodyBytes`     | `1048576` (1 MiB) | Body ceiling. Over it answers 413 before the payload is parsed.              |
| `validateResponse` | dev and test      | `true`, `false`, or a sampling rate in `(0, 1)`.                             |

### On a bad request

**400**, with the detail in `data` — the field h3 serializes on every runtime:

```json
{
  "statusCode": 400,
  "statusMessage": "Bad Request",
  "data": {
    "code": "VALIDATION_FAILED",
    "issues": [
      {
        "path": "params.stationId",
        "message": "Too small: expected string to have >=1 characters"
      },
      {
        "path": "query.limit",
        "message": "Too big: expected number to be <=2000"
      }
    ]
  }
}
```

`path` is rooted at the part of the request it came from, so a client can group
by prefix without a second field. **A submitted value never appears** — not in a
message, not in the path — so a rejected password or token cannot travel back
out through the error.

What does survive is an object _key_, because a path with no key in it is not
actionable. A key `z.strictObject` rejected comes back as a path segment
(`body.password`) with the constant message `Unrecognized key`, never as prose.
Three things worth knowing about that narrow exception:

- For a declared field the key is the schema's own. For a `z.record` it is
  caller data, so a route whose _keys_ are secrets (`{ [apiKey]: … }`) should
  not use one.
- The guarantee covers zod's built-in messages. A schema that supplies its own
  `error` callback interpolating `issue.input` is forwarded verbatim and owns
  that choice.
- A failed `z.union` reports one issue at the union's own path
  (`{ "path": "body", "message": "Invalid input" }`) and its branch failures are
  deliberately not flattened: they contradict each other, and their prose
  carries caller key names. Use `z.discriminatedUnion` when a sum-typed body
  needs per-field detail — it reports against the discriminator directly.

Params and query are checked together, so one response names every bad field.
The body is only read once they pass: a request that is already doomed should
not buy a payload read.

Two more, both carrying `data.code`:

| Status | `data.code`              | When                                                            |
| ------ | ------------------------ | --------------------------------------------------------------- |
| `413`  | `BODY_TOO_LARGE`         | Declared or measured body over `maxBodyBytes` (also in `data`). |
| `415`  | `UNSUPPORTED_MEDIA_TYPE` | A body that is not JSON. This wrapper reads JSON only.          |

A declared `content-length` is rejected before a byte is parsed. A body sent
chunked — no declared length — is measured after the read, so the ceiling bounds
what reaches `JSON.parse` and the schema, which is the cost this wrapper owns;
the request size itself is bounded by the platform. On Cloudflare, Nitro reads
the whole body before this wrapper runs. See
[Inbound request bodies](#inbound-request-bodies-what-the-worker-reads-before-a-route-runs).

The 415 covers a body sent with **no `content-type` at all**, not only one sent
with the wrong type. Declaring `application/json` is what forces a CORS
preflight, so a body with no media type is a simple request any cross-origin
page can send; accepting it would hand back the protection the 415 buys. A
request carrying no body is left to the schema's own 400 instead — there is no
media type to object to.

### On a bad response

`response` is an assertion about what the route promises. A returned value that
fails it is a server defect: one structured `error` through
`@narduk-enterprises/narduk-logging` carrying the issue paths and the **matched
route template** — not the raw path — then **500**. In development and test the
message names the offending paths; in production it says nothing beyond
`Internal Server Error`, because the detail describes data the caller was never
entitled to see.

**Checking is on in development and test, off in production by default.** Every
request on Workers pays for it in metered CPU, on data the server itself
produced, and a response-shape mismatch is a code defect — which is what
`nuxt dev`, vitest and CI are for. Turn it on with `validateResponse: true`, or
keep most of the signal for a fraction of the cost with
`validateResponse: 0.01`.

Because it is an assertion, **the value the client receives is exactly what the
handler returned**, whether or not the check ran. That is deliberate: a route
must not behave differently in production because validation was skipped. Two
consequences:

- A response schema must not `.transform()`, default or coerce. Nothing it does
  would reach the wire.
- An unpromised field is not silently stripped. Use `z.strictObject` to have one
  _rejected_ instead — loudly, in dev and test, where you can fix it.

### Composition order with `defineRateLimitedHandler`

**Rate limit outside, validate inside.** A throttled caller is then rejected
before the body is read or a schema runs, which is the order that matters when
the caller is abusive:

```ts
export default defineRateLimitedHandler(
  defineValidatedHandler({
    query: stationSearchQuery,
    handler: ({ query }) => listStations(query),
  }),
  { key: 'marine-public-api', limit: 120, windowSeconds: 60 },
)
```

Reversed, every request over the limit still pays for parsing and validation
before the 429. There is no `rateLimit` option on `defineValidatedHandler` on
purpose: one wrapper, one job, and the order stays visible in the route file.

### Before and after: a real Buoys route

`apps/web/server/api/ndbc/stations/[stationId]/history.get.ts`, as it stands
today:

```ts
export default defineEventHandler(async (event) => {
  setMarinePublishedHistoryCacheHeader(event)
  const stationId = getRouterParam(event, 'stationId')
  if (!stationId)
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'stationId is required',
    })
  const result = stationHistoryQuerySchema.safeParse(getQuery(event))
  if (!result.success)
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid station history query',
      data: result.error.flatten(),
    })
  return withPublishedDataErrorHandling(
    event,
    'Published station history is unavailable.',
    async () => {
      const { product } = await readCachedPublishedBuoyStatus()
      return publishedStationHistoryResponse(product, stationId, result.data)
    },
  )
})
```

and the same route through the wrapper:

```ts
export default defineValidatedHandler({
  params: z.object({ stationId: z.string().min(1) }),
  query: stationHistoryQuerySchema,
  handler: ({ event, params, query }) => {
    setMarinePublishedHistoryCacheHeader(event)
    return withPublishedDataErrorHandling(
      event,
      'Published station history is unavailable.',
      async () => {
        const { product } = await readCachedPublishedBuoyStatus()
        return publishedStationHistoryResponse(product, params.stationId, query)
      },
    )
  },
})
```

What changed: the hand-written presence check is gone and `params.stationId` is
`string`, not `string | undefined`; the two hand-written 400s collapse into one
documented body; and a request that is wrong in both the param and the query is
now told both at once instead of only the first. The route keeps its own cache
header and its own error wrapper — this wrapper owns the contract, not the
route's behaviour.

### Sharing the contract with a client

The schemas are ordinary values, so a route can export them and a caller can
reuse them without a second declaration:

```ts
// server/api/stations/index.get.ts
export const contract = { query: stationSearchQuery, response: stationList }
export default defineValidatedHandler({ ...contract, handler: listStations })
```

```ts
// app/composables/useStations.ts
import { contract } from '~~/server/api/stations/index.get'

type StationQuery = z.input<typeof contract.query>
```

That needs nothing from this package. Generating a typed `$fetch` client across
the whole API surface is a larger piece of work and is deliberately not here.

## Published-data routes: `definePublishedDataHandler`

A public read whose success is cacheable and whose failure is not
(narduk-libs#514). It replaces `defineEventHandler` at the route:

```ts
// server/api/stations/index.get.ts
export default definePublishedDataHandler(
  async (event) => listStations(getQuery(event)),
  {
    profile: 'live',
    tags: ['published-data'],
    fallbackMessage: 'Station data is temporarily unavailable.',
  },
)
```

- **The cache profile is applied after success only.** A route that calls
  `setCacheProfile` first advertises a 400 or 404 as publicly cacheable for the
  profile's TTL. Here an error never gets a cacheable posture, and the
  `error-cache` plugin makes it `private, no-store`. `setCacheProfile`'s own
  guards still apply to the success path.
- **An internal failure is a sanitized 503.** Anything thrown without a
  `statusCode` (a failed fetch, a schema error whose message dumps every field)
  is logged through the request logger and answered with `fallbackMessage`. A
  deliberate `createError({ statusCode: 404 })` passes through unchanged.
- **Rate limiting is opt-in.** Pass `rateLimit` (the
  [`defineRateLimitedHandler`](#per-route-rate-limits-defineratelimitedhandler)
  options) to put a limit in front of the read; without it none is applied. On a
  shared-cacheable route pass `headers: 'none'` with it, because the
  `RateLimit-*` family is per caller.

## Edge cache: setCacheProfile

`setCacheProfile` owns every `Cache-Control` string a route would otherwise
hand-write. Import it from
`@narduk-enterprises/narduk-core/server/utils/cacheProfile`.

```ts
import { setCacheProfile } from '@narduk-enterprises/narduk-core/server/utils/cacheProfile'

export default defineEventHandler(async (event) => {
  const stations = await readPublishedStations()
  setCacheProfile(event, 'live', { tags: ['stations', 'published-data'] })
  return stations
})
```

| Profile  | Browser | Edge  | Stale window | For                                                     |
| -------- | ------- | ----- | ------------ | ------------------------------------------------------- |
| `live`   | 60s     | 300s  | 900s         | the live-ish surface of a published product             |
| `slow`   | 300s    | 900s  | 1800s        | history, coverage, other slower-changing published data |
| `static` | 300s    | 3600s | 86400s       | documents that change on deploy, not per request        |
| `none`   | —       | —     | —            | `private, no-store`                                     |

A route that genuinely needs its own numbers passes them inline instead of
adding a profile:
`setCacheProfile(event, { maxAge: 30, sMaxAge: 120, swr: 600 })`. Add
`private: true` to keep the response off the edge entirely.

### Why no `s-maxage`

The obvious encoding of "60s in the browser, 300s at the edge, serve stale for
900s" is `public, max-age=60, s-maxage=300, stale-while-revalidate=900`. **It
does not work.** Cloudflare, following
[RFC 9111 §4.2.4](https://www.rfc-editor.org/rfc/rfc9111#section-4.2.4),
documents that `s-maxage`, `must-revalidate` and `proxy-revalidate` each
_disable_ `stale-while-revalidate` and `stale-if-error`:

> When you want `stale-while-revalidate` to take effect at the edge, use
> `max-age` for the freshness window — not `s-maxage`. If you need a longer edge
> TTL than browsers should honor while still using `stale-while-revalidate`, use
> `cdn-cache-control` for the edge directive.
>
> —
> [Workers Cache configuration](https://developers.cloudflare.com/workers/cache/configuration/)

So a profile's `sMaxAge` is emitted as `CDN-Cache-Control: max-age=<n>`, never
as `Cache-Control: s-maxage=<n>`. The browser reads `Cache-Control`, the edge
reads the more specific `CDN-Cache-Control`, and the stale window survives in
both. Header precedence at Cloudflare is `cloudflare-cdn-cache-control` >
`cdn-cache-control` > `Cache-Control`; the helper uses the middle one because
Cloudflare respects it _and_ passes it downstream, so the edge TTL stays visible
when you are debugging a response.

### This needs Workers Cache turned on

Workers run _before_ the cache, so a response a Worker generates is not stored
by the zone cache at all. These headers bind only once the app opts into Workers
Cache in its Wrangler config (Wrangler >= 4.69.0). This is the narduk-app
standard mechanism, verified against
[Workers Cache configuration](https://developers.cloudflare.com/workers/cache/configuration/)
on 2026-09-18 (narduk-libs#435); a zone Cache Rule is not used because the
Worker-owned switch is versioned with the code and needs no dashboard state:

```jsonc
{
  "cache": { "enabled": true },
}
```

Until an app adds that, `setCacheProfile` still produces a correct browser
`Cache-Control` and the edge headers are inert. Turning it on in an existing app
is a per-app change with its own preconditions, proof and rollback:
[narduk-app-tools `docs/workers-cache.md`](../../tooling/narduk-app-tools/docs/workers-cache.md).

**It is not a one-line change.** With the switch on, Cloudflare checks the cache
_before_ invoking the Worker and stores what the Worker returns according to its
headers — and a response with **no** `Cache-Control` (and no `Expires`) is still
stored by RFC 9111 heuristic freshness: a 200 for 2 hours, a 404 for 3 minutes
([Cache-Control semantics](https://developers.cloudflare.com/workers/cache/configuration/#cache-control-semantics)).
Before turning it on, every route needs an explicit posture — a profile, or
`setCacheProfile(event, 'none')` for anything per-user. The cache bypasses
itself only for a response with `Set-Cookie`, or a request with `Authorization`
unless the response says `public`.

Preconditions, checked by `narduk-app foundation:check:deployment` sub-check
12.7:

- narduk-core **>= 2.10.1**: thrown 4xx/5xx/429 are `private, no-store`
  (narduk-libs#429), including when answered as JSON (#493), preference-shaped
  responses are (#427), SSR HTML under a nonce CSP is (#435), and a response
  with no posture is private. An older core with the switch on fails 12.7.
- The per-request header strip below (#412, #418) becomes load-bearing the same
  day: a stored response would otherwise carry one caller's quota and
  correlation id to everyone.

Proving it: a HIT is `Cf-Cache-Status: HIT` on the second GET of a `live` /
`slow` route.
`narduk-app verify --live <production-url> --edge-cache-path /api/<route> --edge-uncached-path /`
makes both requests and also proves a route that must never be stored does not
HIT. A preview-safe hostname (`*.workers.dev`, a version preview) forces every
profile to `none`, so a HIT can only be proven against the production hostname.

By default Workers Cache partitions its cache by Worker version, so **a
deployment already starts from a cold cache** — a release is visible immediately
with nothing to purge. That default only changes if an app sets
`cache.cross_version_cache: true`, which narduk apps leave off.

### Cache-Tag

`tags` emits a `Cache-Tag` header so a later purge can invalidate exactly the
responses a change affected. Purge by tag is available on every Cloudflare plan
(it stopped being Enterprise-only on 2025-04-01), and Cloudflare strips the
header before the client sees it.

Tags must be printable ASCII with no spaces or commas, at most 1024 characters
each, and at most 1000 per response. Tags that violate that are dropped rather
than throwing — the platform drops them silently too — and the header is omitted
when none survive. Deduplication is case-insensitive because purge matching is.

Purging is `cache.purge({ tags: [...] })` from `cloudflare:workers` inside the
Worker. A zone-level purge — dashboard, `/zones/{id}/purge_cache`, or Terraform
— does **not** reach Workers Cache content.

### Guards

`setCacheProfile` emits `private, no-store` instead of the requested profile,
and no `Cache-Tag`, when any of these hold:

| Guard               | Reason                                                         |
| ------------------- | -------------------------------------------------------------- |
| `error-status`      | the response status is >= 400                                  |
| `set-cookie`        | a `Set-Cookie` is already on the response                      |
| `vary-wildcard`     | `Vary: *`, which Cloudflare treats as uncacheable anyway       |
| `preview-safe-mode` | `previewSafeMode` — a preview must not populate a shared cache |
| `nonce-csp-html`    | an SSR page render on an app serving the nonce CSP             |

None of these are overridable by configuration. The returned
`CacheProfileResult` carries `suppressedBy` so a caller or a test can see which
guard fired rather than discovering a missing header later.

### Per-request headers never ride on a shared-cacheable response

A shared cache stores one caller's response and replays it to everyone. So when
`setCacheProfile` emits a shared-cacheable profile (`live`, `slow`, `static`, or
any inline profile that is not `private` / `noStore`) it removes the headers
that describe that one caller (narduk-libs#412, #418):

- the `RateLimit-*` quota — `RateLimit`, `RateLimit-Policy`, `RateLimit-Limit`,
  `RateLimit-Remaining`, `RateLimit-Reset` — and `Retry-After`;
- `x-request-id` and `Server-Timing`.

`defineRateLimitedHandler` and the request logger write those before the handler
picks its profile, so the default order is covered by `setCacheProfile` itself;
a route no longer needs `headers: 'none'` to be safe. The `shared-cache-headers`
Nitro plugin covers the reverse order — anything written _after_ the profile,
including a returned web `Response` carrying its own `Cache-Control: public` —
so the order of operations does not matter. `none`, `private` profiles, and
error responses (a 429 keeps its `Retry-After` and quota) are never touched.

### A response with no posture is private by default

A route that never picks a profile used to leave with no `Cache-Control` at all,
which lets a shared cache apply its own default. A narduk-core Nitro plugin
(`default-private-cache`, narduk-libs#435 step 1) writes
`Cache-Control: private` on any response that leaves with no cache posture — SSR
pages, API JSON, a returned `Response` without its own header.

Any explicit posture wins and is left exactly as set: `Cache-Control`,
`CDN-Cache-Control`, `Cloudflare-CDN-Cache-Control`, `Surrogate-Control` or
`Expires`, whether it came from `setCacheProfile`, `setResponseHeader`, Nitro
`routeRules` headers or cached handlers, or the returned `Response` itself.
Build assets under `app.buildAssetsDir` (`/_nuxt/`) are left alone, and thrown
errors keep the `private, no-store` below. A route that should be edge-cacheable
says so with `setCacheProfile`.

### Thrown errors are no-store by default

The `error-status` guard above only fires when a route _calls_ `setCacheProfile`
after the response status is already >= 400. A route that
`throw createError({ statusCode: 404 })` — or a 429 from
`defineRateLimitedHandler` — never calls `setCacheProfile` at all, so Nitro's
own error page ships its default `Cache-Control: no-cache` instead, which
Cloudflare Workers Cache **stores and revalidates** once an app turns on
`"cache": { "enabled": true }` (narduk-libs#429).

A narduk-core Nitro plugin (`error-cache`) closes that gap: every response whose
status is >= 400 is forced to `private, no-store` with the same shared-cache
headers stripped as the `error-status` guard removes, even when the route
already called `setCacheProfile(event, 'live')` before throwing — the plugin
re-checks the final status after the throw, not the status at the time
`setCacheProfile` ran. `defineRateLimitedHandler` also sets the posture itself
immediately before its 429 throw, as a belt-and-suspenders — the plugin is the
backstop either way. `Retry-After` and the `RateLimit-*` family are not
shared-cache headers and are never touched.

A thrown error answered as **JSON** needs a second piece (narduk-libs#493). For
an `/api/*` or `.json` path, `Accept: application/json`, a CORS fetch, or curl,
Nuxt's error handler hands the error back to Nitro, and Nitro's own handler
sends the response itself: `no-cache` on every 404, and the plugin's hook never
runs. So narduk-core also prepends a Nitro error handler (`json-error-no-store`)
that answers those errors itself, with Nitro's own status and body and
`private, no-store`. HTML errors still go through Nuxt's error page and the
plugin. `nuxt dev` is left alone.

This is a safe precondition for edge-caching error-adjacent routes: do not
enable Workers Cache in a consuming app until it is running a narduk-core
release that includes this plugin.

### Nonce-CSP HTML is never edge-cached

On an app with `nardukCore.security.headers` on (`enforce`, and `report-only`,
which stamps the same nonce), SSR HTML always ships `private, no-store` with the
shared-cache headers stripped: nuxt-security mints the nonce per request into
both the HTML and the CSP header, so a stored page would replay one visitor's
nonce to everyone. `setCacheProfile` refuses it (`nonce-csp-html`) and the
`nonce-csp-cache` plugin backstops the final `text/html` response. Use
nonce-free JSON endpoints for edge caching — they keep their profile. Rationale:
narduk-libs#435.

### Tuning without touching a route

`runtimeConfig.cache.profiles` overrides the seconds of any named profile. Each
field is optional and the rest of the profile is kept:

```ts
// nuxt.config.ts
runtimeConfig: {
  nardukRateLimit: {
    enabled: true,          // false disables every rate-limited route
    limit: 120,             // default for routes that declare none
    windowSeconds: 60,
    headers: 'both',
    bindings: { 'marine-public-api': 'MARINE_RL' },
    routes: { 'marine-public-api': { limit: 60, windowSeconds: 10 } },

  cache: {
    profiles: {
      live: { sMaxAge: 120 },
      static: { noStore: true },
    },
  },
}
```

`routes[key]` wins over what the route itself declared, so an allowance can be
retuned without editing route code. `enabled` is an AND across every layer: the
block switch disables every route regardless of what a route asks for. A
non-integer or non-positive override is rejected rather than adopted.

### Relationship to `enforceRateLimitPolicy`

`runtime/server/utils/rateLimit.ts` keeps its closed `RATE_LIMIT_POLICIES`
registry for this layer's own auth, admin and upload routes, and apps already
calling `enforceRateLimitPolicy` are unaffected. `defineRateLimitedHandler` is
the surface for an **app's own** routes: it adds the handler wrapper, the
`RateLimit-*` headers, the exempt list and the denial log record, over the same
`ratelimits` bindings and the same client-address resolver.

Note what that means before adding a freshness check to an app already enrolled
in an uptime detector: a monitor matching `"status":"ok"` alerts on `degraded`
as well as on `error`, because the substring is simply absent. That is often the
point — a stale feed should be noticed — but it makes `warnAfter` an alerting
threshold, not just a dashboard one. Pick it accordingly, put the
not-worth-a-page band in `noticeAfter`, or move the monitor to the HTTP status
so only `failAfter` pages.

Negative, fractional and non-numeric overrides are ignored rather than emitted.
An inline profile is the app's own configuration already, so it is used
verbatim.

### Migrating an app off hand-written strings

`buoys` is the worked example. Its three helpers become three calls, and the
broken stale windows start working:

```diff
--- a/apps/web/server/utils/marine-api-route.ts
+++ b/apps/web/server/utils/marine-api-route.ts
+import { setCacheProfile } from '@narduk-enterprises/narduk-core/server/utils/cacheProfile'
+
 export function setMarinePublishedDataCacheHeader(event: H3Event) {
-  setHeader(event, 'Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=900')
+  setCacheProfile(event, 'live', { tags: ['published-data'] })
 }

 export function setMarinePublishedHistoryCacheHeader(event: H3Event) {
-  setHeader(
-    event,
-    'Cache-Control',
-    'public, max-age=300, s-maxage=900, stale-while-revalidate=1800',
-  )
+  setCacheProfile(event, 'slow', { tags: ['published-data', 'ndbc-history'] })
 }
```

```diff
--- a/apps/web/server/utils/marine-sitemap.ts
+++ b/apps/web/server/utils/marine-sitemap.ts
+import { setCacheProfile } from '@narduk-enterprises/narduk-core/server/utils/cacheProfile'
+
 export function setMarineSitemapCacheHeader(event: H3Event) {
-  setHeader(
-    event,
-    'Cache-Control',
-    'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
-  )
+  setCacheProfile(event, 'static', { tags: ['sitemap'] })
 }
```

The `live`, `slow` and `static` profiles carry Buoys' existing numbers
unchanged, so the browser TTL of every route is identical before and after. What
changes is that the edge TTL moves to a header Cloudflare will honor and the
stale windows stop being silently discarded.

## Per-browser state: `useStoredState`

`@narduk-enterprises/narduk-core/app/stored-state` keeps a per-browser
convenience (a sidebar's open state, a basemap, a dismissed guide) in Web
Storage (narduk-libs#993). It is an explicit import, not an auto-import.

```ts
import { useStoredState } from '@narduk-enterprises/narduk-core/app/stored-state'

const BASEMAPS = ['streets', 'satellite'] as const
type Basemap = (typeof BASEMAPS)[number]

const navOpen = useStoredState('narduk-farm:nav-open', { default: true })
const basemap = useStoredState<Basemap>('lakestat:basemap', {
  default: 'streets',
  validate: (value): value is Basemap => BASEMAPS.includes(value as Basemap),
})

navOpen.value = false // written back after render
basemap.clear() // removes the key and restores the default
```

- **Hydration-safe.** The server and first paint hold the default. The stored
  value is applied in `onMounted`, so client and server render the same markup.
  Never read storage in a `computed` or during setup.
- **Validated.** The stored string goes through `parse` (default `JSON.parse`)
  and then `validate`. Without either, a value is accepted only when it has the
  default's JSON type. Anything else falls back to the default.
- **Failure-tolerant.** Every read, write and remove is its own try/catch, and
  so is the `window.localStorage` access itself, which throws `SecurityError`
  when storage is blocked. Blocked or full storage leaves a working in-memory
  ref, so the choice lasts for this visit only.
- **The key is used as given**, with no prefix, so an app that adopts this keeps
  its viewers' stored choices. `storage: 'session'` uses `sessionStorage`.
- `createStoredState(key, options)` is the Nuxt-free half (`read`, `write`,
  `remove`) for code outside a component. `resolveWebStorage(area)` answers the
  storage area or `null`; `usePersistentTab` now reads storage through it too.

## Reader preferences: units, time zone and locale

A Narduk app stores measurements in SI and displays them in whatever the reader
asked for. `usePreferences()` holds the choice, `useFormatters()` applies it,
and the pure formatters underneath do the arithmetic. **Adoption is per value**:
nothing here rewrites an app's existing display code, and a page opts in one
call site at a time.

```vue
<script setup lang="ts">
const format = useFormatters()
const { setUnits, units } = usePreferences()
</script>

<template>
  <dl>
    <dt>Wave height</dt>
    <dd>{{ format.height(buoy.waveHeightMetres) }}</dd>
    <dt>Wind</dt>
    <dd>{{ format.speed(buoy.windSpeedMetresPerSecond) }}</dd>
    <dt>Observed</dt>
    <dd>{{ format.dateTime(buoy.observedAt) }}</dd>
  </dl>
  <UButton @click="setUnits(units === 'imperial' ? 'metric' : 'imperial')">
    Switch units
  </UButton>
</template>
```

Both composables are auto-imported by this module. The pure functions import
explicitly from `@narduk-enterprises/narduk-core/shared/utils/units`, and a
Nitro route reads the same preferences with `readPreferences(event)` from
`@narduk-enterprises/narduk-core/server/utils/preferences`.

The same module exports the raw conversions both ways: SI to display
(`celsiusToFahrenheit`, `metresToFeet`, `metresPerSecondToKnots`, ...) and each
inverse (`fahrenheitToCelsius`, `feetToMetres`, `knotsToMetresPerSecond`, ...),
with exact factors. It also exports `compassPoint16(degrees)`, which names the
nearest of `NE_COMPASS_POINTS_16` for any finite bearing, negative or above 360,
and returns `undefined` for absent input. Great-circle distance is
`haversineDistanceMetres` in `@narduk-enterprises/narduk-mapkit/geometry`.

### The cookie

One cookie, `ne_prefs`, carries the whole selection as a small versioned
parameter string:

```text
v=1&u=imperial&tz=America%2FChicago&l=en-US
```

It is read during SSR, so the first paint already has the reader's units — there
is no client-only flash of the wrong one. It is **validated on read**: a cookie
from a future schema version, a truncated one, a hand-edited one, one naming a
time zone this runtime does not know, or one that is not a parameter string at
all decodes to _no selection_ and the documented defaults apply. A bad cookie is
never a 500, and a cookie with one bad field keeps its good ones.

Only fields the reader actually chose are written, so setting units leaves the
time zone following the defaults.

### Defaults when the cookie is unset

| Preference | Default                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| `locale`   | the highest-quality usable tag in `Accept-Language`, else `en-US`              |
| `units`    | `imperial` when that locale's region is `US` (`en-US`, `es-US`), else `metric` |
| `timeZone` | `UTC`, until the browser reports its own — see below                           |

The region is read as written and never maximised:
`Intl.Locale('en').maximize()` answers `en-Latn-US`, which would quietly make
every region-less English speaker in the world imperial.

### Hydration

The server-rendered text and the client's first render are the same string, so
Vue reports no hydration mismatch (Buoys' end-to-end console tracker fails on
one). Two rules get that:

1. **Both sides read the same cookie.** `useCookie` gives the same value during
   SSR and in the browser.
2. **Both sides read the same defaults.** The server resolves them once from
   `Accept-Language` and puts the answer in the Nuxt payload through `useState`.
   The client never re-derives them from `navigator.language`, which can
   disagree with the header that was actually sent.

The browser's time zone is the one input the server cannot have, so it is
**not** read during render. When the cookie carries no zone, both sides render
`UTC`; after mount, `usePreferences()` detects
`Intl.DateTimeFormat().resolvedOptions().timeZone` and writes it to the cookie,
which is an ordinary reactive update on an already-hydrated page. A reader who
has chosen a zone is left alone.

`tests/preferences-state.test.ts` proves this the way Vue does: it renders with
`renderToString`, hydrates that exact markup with a real
`createSSRApp().mount()`, and fails on a hydration warning. Its last case is a
control that reproduces the naive implementation — the client re-deriving its
own defaults — and requires the warning to appear, so a passing suite is not
merely a suite that never looks.

### Cache safety

HTML rendered with one reader's units must never be served to another reader out
of a shared cache. Calling `usePreferences()` during SSR, or `readPreferences()`
in a route, marks the response. A marked response is forced to
`Cache-Control: private, no-store` with `Vary: Cookie, Accept-Language`, and
every shared-cache header is **removed** — `CDN-Cache-Control`,
`Cloudflare-CDN-Cache-Control`, `Surrogate-Control`, `Cache-Tag`, `Expires`, and
`Age`. Cloudflare honours `CDN-Cache-Control` over `Cache-Control`; leaving it
in place would store the body at the edge even with `private, no-store`.

That rewrite happens in three places so call order cannot leak a shared profile:

- **`markPreferencesInfluenced`** (called by `usePreferences()` /
  `readPreferences()`) strips any cache headers already written on the event.
- **`setCacheProfile`** gains a `preferences-cookie` suppression reason, so a
  route that reads preferences cannot advertise a shared-cacheable profile, and
  on suppression it deletes the CDN/tag headers rather than leaving a leftover
  `CDN-Cache-Control` from an earlier `setCacheProfile('live')`.
- **The `preferences-cache` Nitro plugin** re-checks the flag on
  `render:response` (SSR HTML) **and** `beforeResponse` (every response,
  including API routes). `render:response` does not run for `defineEventHandler`
  routes. On `beforeResponse` it also rewrites a web `Response` the handler
  returned: h3 copies that object's headers onto the event **after** the hook,
  so stripping the event alone would still ship the `Response`'s own
  `CDN-Cache-Control`. A proxied `fetch()` response has immutable headers and is
  rebuilt around the same body.

`Accept-Language` is in `Vary` because a tz-only cookie
(`v=1&tz=America/Chicago`) still derives locale and units from that header. Two
Chicago readers, `en-US` vs `de-DE`, share the cookie value and must not share a
cache key.

Nothing downgrades a response that never read preferences, so **an app's
existing cache profiles are unchanged** — Buoys' `live`/`slow`/`static` routes
keep exactly the headers they have today until they opt a value in.

An app that needs its SSR HTML edge-cached should therefore not format on the
server: return canonical SI values from a shared-cacheable route and bind the
formatters in the browser, where the preference cookie costs nothing.

#### Incompatible with Nitro `routeRules` `swr` / `cache` / `isr`

Nitro `routeRules: { '/stations': { swr: 60 } }` (and `cache` / `isr`) wraps the
page in `cachedEventHandler`. That cache keys on the path only, stores the first
reader's HTML, and **replays it without re-running the page, the formatters, or
this plugin**. HTTP `private, no-store` on the first response cannot prevent
that: the wrapper overwrites `Cache-Control` with `s-maxage` and serves reader
A's Fahrenheit to everyone.

A page that calls `usePreferences()` / `useFormatters()` **must not** sit behind
those rules. Drop the cache rule on that route, or format in the browser. This
is not statically knowable at module setup — whether a given page reads
preferences is a runtime fact — so the module does not fail the build. In
development, a preference-influenced response produced inside a Nitro cached
handler (`event.context.cache`, the marker Nitro sets) logs a one-time
`console.warn` for that path. Several estate apps already use `swr` (tx-spends,
papa-everetts); those pages must not adopt the formatters until the rule is
gone.

#### Incompatible with `event.respondWith()`

`event.respondWith(response)` is an h3 escape hatch that writes the response
itself, so h3 never calls `onBeforeResponse` for it and Nitro's `beforeResponse`
hook — this plugin's last-moment backstop — does not run at all. Anything the
`Response` carries, `CDN-Cache-Control` included, goes out verbatim over the
headers `markPreferencesInfluenced` stripped.

A route that reads preferences must `return` its `Response` rather than call
`event.respondWith()`. Returning it is the normal Nitro shape and is fully
covered; `respondWith` is not reachable from any hook and cannot be defended
library-side.

### The formatters

Every formatter is a standalone pure function over its arguments, so importing
one does not ship the rest. Canonical inputs are SI.

| Function                                                      | Input                                  | Imperial                    | Metric                     | Default precision |
| ------------------------------------------------------------- | -------------------------------------- | --------------------------- | -------------------------- | ----------------- |
| `formatDistance`                                              | metres                                 | feet below 1 mi, then miles | metres below 1 km, then km | 0 small / 1 large |
| `formatSpeed`                                                 | metres per second                      | mph                         | km/h                       | 1                 |
| `formatTemperature`                                           | degrees Celsius                        | Fahrenheit                  | Celsius                    | 0                 |
| `formatHeight`                                                | metres                                 | feet                        | metres                     | 1                 |
| `formatLength`                                                | metres                                 | feet                        | metres                     | 0                 |
| `formatPressure`                                              | hectopascals                           | inHg                        | hPa                        | 2 / 0             |
| `formatDecimal`                                               | number                                 | n/a                         | n/a                        | up to 3           |
| `formatZonedDate` / `formatZonedTime` / `formatZonedDateTime` | `Date`, epoch ms or a parseable string | n/a                         | n/a                        | `Intl` styles     |

`formatHeight` and `formatLength` never auto-scale, which is why a 1.4 m swell
stays `4.6 ft` instead of becoming `0.0 mi`. `formatPressure` appends its symbol
itself because `Intl`'s sanctioned unit list has neither hectopascals nor inches
of mercury; everything else uses a real `style: 'unit'` so the locale decides
spacing and symbol form.

Rules the whole suite keeps:

- **No ambient clock, zone or locale.** `timeZone` and `locale` are arguments;
  absent, the fixed fallbacks `UTC` and `en-US` apply, never the host's.
  Offset-less date-time strings (`2026-03-08T00:00:00`) are UTC, never the host
  zone. A bare `YYYY-MM-DD` is a floating calendar date in `formatZonedDate`
  only, so Chicago does not render it as the previous day.
- **Absent input has one answer.** `null`, `undefined`, `NaN`, `Infinity` and an
  unparseable date all render an em dash (`NE_EMPTY_VALUE`), overridable per
  call with `empty`. No call site has to guard and no reader ever sees `NaN ft`.
- **Per-call options win**, so one value can opt out of the reader's units
  without touching the rest of the page:
  `format.height(x, { units: 'metric' })`.
- **No new dependency.** `Intl.NumberFormat` and `Intl.DateTimeFormat` do the
  work, and `Intl` owns every daylight-saving transition date rather than a
  hand-rolled table.

Knots are deliberately not a third unit system: the preference has two values,
and a maritime app that wants knots should say so at the call site rather than
make a stored preference mean something other than what it says.

### Relation to `narduk-shell/format`

`@narduk-enterprises/narduk-shell/format` is the estate's framework-free
formatter suite for dates, numbers, money and percentages, with no notion of a
reader. This module is the preference layer: unit conversion plus the store that
decides which units. An app can use either or both; nothing here duplicates a
`narduk-shell` export, and this package does not depend on `narduk-shell`.

## Render-safe clock: `useSsrNow`

`Date.now()` read during render is a hydration bug. The server and the browser
read it at different instants, so a relative age ("33 min ago") can straddle a
minute boundary and Vue reports a hydration mismatch. `useSsrNow` gives a
component one "now" that both renders agree on:

```ts
// Auto-imported in apps that enable narduk-core's app features.
const now = useSsrNow('station-page', { tickMs: 60_000 })
const age = computed(() => formatAge(now.value - observedAt))
```

- **Server:** reads `Date.now()` once into `useState('narduk:now:<key>')`.
- **Hydration:** the client renders from that same payload value, so the markup
  matches.
- **After mount:** switches to the browser clock (one update on mount, which
  also refreshes a value carried over from an earlier page on client-side
  navigation), then re-reads it every `tickMs` if given. The interval is cleared
  on unmount.

It returns a readonly `Ref<number>`. Call it from component `setup()`; it
registers `onMounted`/`onBeforeUnmount`. Components that pass the same `key`
share one value. Omit `tickMs` (or pass a non-positive value) for a single
update on mount.

`tests/use-ssr-now.test.ts` proves the contract with `renderToString` and a real
`createSSRApp().mount()` hydrate across a minute boundary, and includes a
control that reproduces the mismatch when the client reads its own clock. The
`narduk/no-render-clock` lint rule points at this composable.

## Live data: `useLiveProduct`

The recommended replacement for a bare `useIntervalRefresh` whenever what it
refreshes is user-visible live content (narduk-libs#374). It takes any refresh
callback -- `refresh` from `useFetch`/`useAsyncData`, a store action -- and
fetches nothing itself:

```ts
// Auto-imported in apps that enable narduk-core's app features.
const { data, refresh } = await useFetch('/api/buoys/status')
const live = useLiveProduct(refresh, {
  intervalMs: 60_000,
  updatedAt: () => data.value?.observedAt, // optional: the product's own freshness
})
// live.updatedAgo -> "3 minutes ago"; live.pending, live.error, live.refresh()
```

- **Hidden tab:** polling pauses while the page is hidden. On return, if a poll
  fell due meanwhile, it refreshes at once and re-arms the interval.
- **Coalesced:** overlapping refreshes -- a click during a tick -- share the run
  already in flight. `refresh()` never rejects; a failure lands in `error` and
  the next success clears it.
- **Hydration-safe:** nothing runs until mount, so `pending` cannot flip before
  the hydrating render. `updatedAgo` is `formatRelative` read against
  `useSsrNow` (key `clockKey`, default `'live-product'`, re-read every
  `labelTickMs`, default 30 s), never against `new Date()`, which the server and
  the browser read at different instants. It is `null` until there is something
  to date: `updatedAt` when given, else the last successful refresh.

`enabled` (reactive) pauses polling without disabling `refresh()`, and
`immediate: false` skips the refresh on mount. Call it from component `setup()`.
`tests/use-live-product.test.ts` proves it through real SSR and hydration on
fake timers.

## Core D1 migrations

The numbered files in `runtime/drizzle/` are applied by `narduk-app db migrate`
(see narduk-app-tools' "Migration config"), which lists this directory as the
`@narduk-enterprises/narduk-core` source and records each file in its ledger.
Upgrading narduk-core and running the app's migrate script (locally and in its
deploy path) applies any new file; nothing is applied at runtime.

| File                          | Adds                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| `0006_user_id_indexes.sql`    | `api_keys_user_id_idx` and `sessions_user_id_idx` (see below) |
| `0007_api_key_hash_index.sql` | unique `api_keys_key_hash_idx` (see below)                    |
| `0008_api_key_revoked_at.sql` | nullable `api_keys.revoked_at` (see below)                    |

`0006` indexes the `user_id` foreign-key columns. `api_keys.user_id` is the only
predicate of narduk-auth's `GET /api/auth/api-keys`, which scanned the whole
table before it. `sessions.user_id` is not a query predicate, but it is the
child column of `users ON DELETE CASCADE`, so each user delete scanned
`sessions`. `CREATE INDEX` holds D1 writes while it builds; both tables are
small in current apps. `tests/user-id-indexes-d1.test.ts` applies every core
migration on Miniflare D1 and checks both lookups with `EXPLAIN QUERY PLAN`. The
Postgres schema (`pg-schema.ts`) declares the same indexes; core ships no
Postgres migrations, so a Postgres app adds them with its own DDL.

`0007` indexes `api_keys.key_hash`, the lookup of every API-key authentication
(`authenticateApiKey`, `authenticateD1ApiKey`). Without it each authentication
scanned `api_keys`, including one presenting a well-formed but fabricated key
(#168). The index is `UNIQUE` because the column is the SHA-256 of a random
32-byte token. `tests/api-key-hash-index-d1.test.ts` checks both lookups the
same way.

`0008` adds `api_keys.revoked_at` (ISO text, null while the key is live), so a
key is withdrawn without deleting its row: `last_used_at`, `key_prefix` and the
scopes are the audit trail a suspected leak needs (#806).
`revokeApiKey(db, id, { userId?, now? })` sets it and returns `true`, or `false`
when no live key matched (unknown id, another user's key when `userId` is given,
or already revoked, whose first `revoked_at` is kept). `authenticateApiKey`
returns `null` for a revoked key, and `authenticateD1ApiKey` answers
`{ ok: false, reason: 'revoked' }`, checked before expiry. narduk-auth's
`DELETE /api/auth/api-keys/:id` revokes this way, and its list omits revoked
keys. Both authenticate functions read the column, so apply `0008` before
deploying a Worker built with this version. A Postgres app adds the column with
its own DDL: `ALTER TABLE api_keys ADD COLUMN revoked_at text;`.
`tests/api-key-revocation-d1.test.ts` covers it on Miniflare D1.

## Type declarations in `types/`

Nuxt's generated tsconfigs (`.nuxt/tsconfig.app.json`, `.server.json`,
`.shared.json`, `.node.json`) include `app/`, `server/`, `shared/**/*.d.ts` and
the root `*.d.ts`, but not `types/`. A `nuxt/schema` augmentation placed in
`types/` was therefore in no program at all. Because `RuntimeConfig` is an open
record, every key it claimed to type stayed `unknown`, and a truthiness guard on
one always took the branch. Nothing reported it.

narduk-core adds `types/**/*.d.ts` (relative to the app root) to all four
generated configs, so a declaration there types what it says (narduk-libs#669).
`shared/types/` works as well and needs nothing from core. An augmentation that
was silently inert before can now surface type errors it was hiding. That is the
point, but expect it on the first typecheck after upgrading.

## Database alias contract

Core-owned server code uses two private Nuxt aliases. `#narduk-core/schema`
selects the PostgreSQL core schema when `databaseBackend` is `'postgres'` and
the D1 schema otherwise, while `#narduk-core/postgres-runtime` selects the real
PostgreSQL adapter or the D1-safe stub. Capability packages that need core
tables may use `#narduk-core/schema` after registering the core Nuxt module.

Application code must use its own `#narduk-db` dialect selector instead. These
private aliases do not replace Nuxt's native `#server/*` paths, and the former
template-era database aliases are not registered.

## List routes: parseListQuery + listResponse

Every list route parses one query shape and answers in one response shape. The
zod schemas live in `@narduk-enterprises/narduk-platform/list-query`; the two
server helpers are auto-imported from `server/utils/listQuery` (or imported
explicitly from `@narduk-enterprises/narduk-core/server/utils/listQuery`).

`parseListQuery(event, options)` validates the event's query string and returns
the parsed query. `options`:

| Option           | Meaning                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `sortable`       | Allowlisted sort keys. The wire form is `'<key>:<asc\|desc>'`.                                      |
| `filters`        | A zod object whose keys are the route's allowlisted filters. Its keys sit flat on the query string. |
| `maxLimit`       | The route's page ceiling. A larger `limit` is **clamped**, not rejected.                            |
| `mode`           | `'offset'` (default) or `'cursor'`.                                                                 |
| `defaultLimit`   | Page size when the caller sends none (default 25, clamped to `maxLimit`).                           |
| `defaultSort`    | Sort applied when the caller sends none.                                                            |
| `maxQueryLength` | Longest accepted `q`, after trimming (default 200).                                                 |
| `searchable`     | Whether the route applies `q` (default `true`). `false` rejects a non-empty `q`.                    |

The schema is `.strict()`: an unknown query key is **rejected**, not silently
stripped, so a typo'd or renamed parameter fails loudly instead of quietly
returning the wrong page. A route with no free-text search sets
`searchable: false` for the same reason — an accepted-and-ignored `q` reads to
the caller as a narrowed page it never got. Any invalid query throws a 400
(never a 500) whose `data` is a stable payload —
`{ code: 'invalid_list_query', fields, unknownKeys, issues }` — naming the
offending keys.

`listResponse(items, { query, total, nextCursor })` returns
`{ items, total, limit, sort, q }` plus `offset` (offset mode) or `nextCursor`
(cursor mode, `null` when the page exhausted the collection). `total` is `null`
when the route deliberately does not count, which keeps a page to one statement.

```ts
// server/api/runners/index.get.ts
export default defineEventHandler(async (event) => {
  const query = parseListQuery(event, {
    filters: z.object({ status: z.enum(['idle', 'busy']).optional() }),
    maxLimit: 100,
    sortable: ['createdAt', 'name'],
    defaultSort: 'createdAt:desc',
  })

  const where = query.filters.status
    ? eq(runners.status, query.filters.status)
    : undefined
  const order =
    query.sort?.direction === 'asc'
      ? asc(runners.createdAt)
      : desc(runners.createdAt)

  // One page query plus one count query, whatever the page size.
  const [total, items] = await Promise.all([
    getDatabaseRow(
      db
        .select({ count: sql`count(*)` })
        .from(runners)
        .where(where),
    ),
    getDatabaseRows(
      db
        .select()
        .from(runners)
        .where(where)
        .orderBy(order)
        .limit(query.limit)
        .offset(query.offset),
    ),
  ])

  return listResponse(items, { query, total: Number(total?.count ?? 0) })
})
```

`GET /api/runners?limit=9999&sort=name:asc&status=idle` answers
`{ items, total, limit: 100, offset: 0, sort: 'name:asc', q: null }`;
`?statuss=idle` answers 400.

A list route may issue at most two SQL statements per request (the
`LIST_QUERY_STATEMENT_CEILING`): one page `SELECT`, plus one `COUNT(*)` when
`total` is a number. Set `total: null` to stay at one statement.

### Worked example: stonx `server/utils/query.ts`

stonx is the first pilot (plan §3). Today it has three list shapes in
`server/utils/query.ts` and the routes that call it:

1. `getPaginationParams` / `buildPaginatedResponse` —
   `{ data, pagination: { total, page, limit, totalPages, hasNextPage, hasPreviousPage } }`
   — used by `admin/games`, `me/positions`, `leaderboard`.
2. A one-off zod envelope in `admin/stats-detailed.get.ts`.
3. `{ results, count, totalPages, page, status }` in `market/screeners.get.ts`,
   whose `limit` caps at **500** (everywhere else that enforces a cap uses 100).
   `watchlist/index.get.ts` and `market/big-movers.get.ts` have no page/limit at
   all.

Those three become one `parseListQuery` + `listResponse` call. The screener
keeps its 500 cap via `maxLimit`; watchlist and big-movers gain a limit by
passing a smaller `defaultLimit`:

```ts
// stonx server/api/market/screeners.get.ts — after the migration
const query = parseListQuery(event, {
  filters: z.object({
    exchange: z.string().optional(),
    sectors: z.string().optional(),
  }),
  maxLimit: 500, // the screener's existing ceiling; not a new default
  sortable: ['symbol', 'marketCap', 'changePercent'],
  defaultSort: 'symbol:asc',
})

return listResponse(rows, { query, total })
// { items, total, limit, offset, sort, q }
```

`parseSortParam` in today's `query.ts` silently falls back to the default on an
unknown field; the contract **rejects** that key instead — the bug class
stonx#208 named. The stonx adoption PR is deferred from this narduk-libs PR.

## Published data: the narduk-data product client

`createNardukDataClient` reads a published [narduk-data](https://data.nard.uk)
product — manifest, immutable artifact, SHA-256 check — with the timeout, retry,
coalescing, stale and freshness policy every consumer was otherwise re-deriving.
`fetchNardukDataJson` is the typed request underneath it, for the reads that are
not a product artifact.

Import from `@narduk-enterprises/narduk-core/server/utils/narduk-data`, or use
the Nitro auto-import inside an app that has the layer installed.

### What it does

- **The manifest names the artifact** — unless `entryPath` is set, the artifact
  URL is built from `manifest.artifact.path` inside `releases/<releaseId>/`, so
  a renamed artifact keeps working. `product.artifactPath` is an optional
  assertion: set it and a manifest naming anything else is refused. A path that
  is not a single safe segment is refused before any request.
- **Secondary entries** — a release can also list artifacts beside the primary
  one in `manifest.artifacts[]`, such as per-lake history at
  `consumer/lakes/texas/canyon-lake/history-1y.json`. Set `product.entryPath` to
  read one of them: the artifact URL is then built from that path, with each
  segment encoded, instead of from `manifest.artifact.path`. It gets the same
  timeout, retry, single-flight, memo, stale-if-error and freshness handling as
  the primary artifact, and is checked against **its own** listed SHA-256. The
  path may have several segments, and each one must be a plain name, so `..`, a
  leading `/` and empty segments are refused before any request. A release that
  lists no such entry fails with `reason: 'missing'`. It is never answered with
  the primary artifact, so a consumer can return "not published" (404), which is
  not an outage. A custom `manifestSchema` must keep `artifacts[]` in its parsed
  output, since entries are looked up there. Each `entryPath` is its own cache
  entry, so size `maxEntries` to the working set you expect to serve.
- **Timeout** — every attempt carries its own `AbortSignal.timeout`
  (`timeoutMs`, default 15000). A caller's `signal` cancels **that caller's**
  read only; it is never given to the shared upstream read, so one client
  disconnecting cannot fail the readers coalesced onto it.
- **Bounded retry** — only for an idempotent `GET`/`HEAD`, and only on a
  transport failure: network, timeout, or HTTP 5xx. A 4xx, a schema failure and
  a checksum mismatch are never repeated, and a non-GET is attempted exactly
  once whatever it returns. `retries` (default 1) is the number of extra
  attempts; there is no backoff sleep, so no timer is left behind.
- **Single-flight** — concurrent readers of the same product join the read
  already in flight instead of each issuing their own. The cache key includes
  every ceiling, validator and hook that decides whether a value is valid, so a
  stricter caller is never answered from a permissive caller's entry.
- **Revalidation downloads only what moved** — once `ttlMs` (default 60000)
  lapses the manifest is re-read. When it still names the same release and the
  artifact checksum already held, the cached value is kept, including its object
  identity, and only its age resets. A caller can therefore memoize work derived
  from `result.data`, such as an index, for as long as the release lasts. A new
  release or a different checksum downloads the artifact again.
- **Stale-if-error, with a cooldown** — opt in with `maxStaleMs` (default 0,
  fail closed). Inside the window an upstream failure is answered from the last
  good value with `source: 'stale-if-error'`; outside it the failure is raised.
  A cancelled caller always gets its cancellation, never stale data instead.
  After a failure answered from the window, `failureCooldownMs` (default 10000)
  serves stale without re-attempting upstream, so a burst does not each pay the
  budget again. **Worst-case added latency** on the outage path is one
  `(retries + 1) x timeoutMs` per upstream leg — 30 s at the defaults for the
  manifest, 60 s if the artifact is the failing leg — paid by the first request
  of each cooldown period, not by every request.
- **Freshness** — every result carries `fetchedAt`, `ageMs`, `source`,
  `releaseId`, `observedAt`/`observedAgeMs` (the newest observation in the
  release, `staleness.newest_as_of`), `evaluatedAt` (when the producer cut the
  release), the producer's own `publishedState` verbatim, and a `state` derived
  from the thresholds in force. Thresholds come from `product.freshness`, or —
  when it declares none — from the manifest's own `fresh_if_less_than_minutes` /
  `warning_if_at_most_minutes`, so an app need not hardcode a duplicate that can
  drift. With neither, `state` is `'unknown'` — never `'fresh'`. `source` and
  `state` are the only two staleness signals, and they answer different
  questions: how it was served, and how old it is.
- **Bounded cache** — one client holds at most `maxEntries` products (default 8)
  and at most `maxCacheBytes` of retained artifact bytes (default 32 MiB), least
  recently used evicted first, so a module-scoped client cannot grow without
  limit in a Worker isolate. `clear()` drops the whole cache and
  `clear(productId)` drops one product's entries.
- **Consumer gates** — `acceptManifest(manifest)` runs before the artifact is
  downloaded and `validate(data, manifest)` before the pair is cached. Either
  throwing refuses the release with `reason: 'rejected'`, and the refusal is
  never cached, so a bad release is re-checked rather than memoised.
- **Request-id propagation and header hygiene** — `context.requestId` is sent as
  `x-request-id` and `context.headers` is merged in, so a request-id middleware
  plugs in without this module generating ids. `accept`, `user-agent` and
  `x-request-id` are managed and cannot be overridden; `authorization`, `cookie`
  and `proxy-authorization` are dropped rather than forwarded; every URL is
  pinned to the configured origin and a redirect is an error (sent as
  `redirect: 'manual'`, which the Workers runtime accepts; a 3xx is never
  followed). Single-flight means the joined callers are answered by a request
  carrying the first caller's id.

Failures are a `NardukDataError` carrying `reason` (`aborted` | `checksum` |
`http` | `missing` | `network` | `rejected` | `schema` | `timeout` |
`too-large`), `status` and `url`. A schema failure is an error state, not a
silent pass-through, and an empty-but-valid artifact stays distinct from a
missing or stale one.

`schema` and `manifestSchema` are any validator with a zod-shaped `safeParse`,
so an app's existing zod schemas plug in and this package adds no validator
dependency of its own. The manifest read has its own ceiling
(`manifestMaxBytes`, default 256 KiB) independent of the artifact's `maxBytes`
(default 16 MiB).

### Before / after: a real Buoys call site

Buoys' `apps/web/server/api/stations/index.get.ts` reads the published
`buoy-status-v1` product. **Before**, the route's
`readCachedPublishedBuoyStatus` came from an app-owned
`server/utils/buoy-status-product.ts` that hand-rolled the whole path — a
hardcoded `https://data.nard.uk`, its own manifest fetch, a 15-second
`AbortSignal.timeout`, a bounded body read, a SHA-256 comparison, a 60-second
memo and an in-flight promise — roughly 120 lines before any buoy-specific
shaping:

```ts
// server/utils/buoy-status-product.ts (app-owned, abridged)
const DATA_ORIGIN = 'https://data.nard.uk'
export const MANIFEST_URL = `${DATA_ORIGIN}/buoy-status-v1/current/manifest.json`

async function fetchJson(fetcher: typeof fetch, url: string) {
  const response = await fetcher(url, {
    headers: {
      accept: 'application/json',
      'user-agent': PUBLISHED_DATA_USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`… failed with ${response.status}.`)
  return response
}

export async function readPublishedBuoyStatus(fetcher: typeof fetch = fetch) {
  const manifest = manifestSchema.parse(
    await (await fetchJson(fetcher, MANIFEST_URL)).json(),
  )
  const artifactBytes = await readBoundedBody(
    await fetchJson(fetcher, artifactUrl(manifest.releaseId)),
  )
  if (
    (await sha256Hex(artifactBytes)) !== manifest.artifact.sha256.toLowerCase()
  ) {
    throw new Error('… checksum does not match its immutable manifest.')
  }
  return {
    manifest,
    product: productSchema.parse(
      JSON.parse(new TextDecoder().decode(artifactBytes)),
    ),
  }
}

export async function readCachedPublishedBuoyStatus(
  fetcher = fetch,
  cache = sharedBuoyStatusCache,
) {
  const memo = cache.entry
  if (memo && memo.expiresAt > cache.now()) return memo.value
  cache.inFlight ??= readPublishedBuoyStatus(fetcher)
    .then((value) => {
      cache.entry = { expiresAt: cache.now() + cache.ttlMs, value }
      return value
    })
    .finally(() => {
      cache.inFlight = null
    })
  return cache.inFlight
}
```

**After**, the same util is a product declaration plus a client instance. The
route body is unchanged, and it gains freshness metadata, a retry it never had,
an explicit stale window it can opt into, and the manifest/artifact URLs the
app's `MANIFEST_URL` export exists to provide. It declares no `freshness`
thresholds because the published `buoy-status-v1` manifest carries its own:

```ts
// server/utils/buoy-status-product.ts (after)
import {
  createNardukDataClient,
  type NardukDataRequestContext,
} from '@narduk-enterprises/narduk-core/server/utils/narduk-data'

const client = createNardukDataClient({ userAgent: PUBLISHED_DATA_USER_AGENT })

const buoyStatusProduct = {
  artifactPath: 'public-buoy-data.json',
  manifestSchema,
  maxStaleMs: 10 * 60_000,
  productId: 'buoy-status-v1',
  schema: productSchema,
  ttlMs: 60_000,
} as const

export async function readCachedPublishedBuoyStatus(
  context?: NardukDataRequestContext,
) {
  const { artifactUrl, data, freshness, manifest, manifestUrl } =
    await client.read(buoyStatusProduct, context)
  return { artifactUrl, freshness, manifest, manifestUrl, product: data }
}
```

```ts
// server/api/stations/index.get.ts — unchanged
const { product } = await readCachedPublishedBuoyStatus()
const data = listPublishedStations(product, result.data)
```

The adoption itself is a Buoys-side change and is not part of this package's
release; the snippet above is the shape it takes.

## Scheduled jobs: `defineScheduledJobs`

`@narduk-enterprises/narduk-core/server/scheduled-jobs` is the Cloudflare cron
dispatcher (narduk-libs#990). You declare jobs with the exact cron expressions
they answer to. Each trigger runs only the jobs that declare `controller.cron`,
each behind its own error boundary and logged like narduk-logging's `logJob`.
Nothing it returns rejects.

```ts
// server/plugins/scheduled-jobs.ts
import { defineScheduledJobs } from '@narduk-enterprises/narduk-core/server/scheduled-jobs'

export const jobs = [
  {
    name: 'estate-export',
    cron: '0 3 * * *',
    run: ({ env, log }) => exportEstate(env, log),
  },
  {
    name: 'estate-retention',
    cron: '0 3 * * *',
    run: ({ env }) => pruneOldRows(env),
  },
]

export default defineScheduledJobs<Env>(jobs)
```

- **One hook, not one per job.** Nitro runs `cloudflare:scheduled` hooks in
  series, so the first hook that throws skips every later one: a failed export
  silently stopped the retention prune. The dispatcher runs the matched jobs
  under `Promise.allSettled` and resolves, so neither its jobs nor any other
  hook get skipped.
- **Exact match only.** A cron that no job declares is a logged no-op, never
  "run everything". An app whose job ran on every trigger must now declare its
  cron.
- **Parity with wrangler.** `declaredCrons(jobs)` lists what the jobs answer to.
  `cronParity(jobs, wrangler.triggers.crons)` returns `unscheduled` (declared,
  but wrangler never fires it, so the job is dead) and `unhandled` (fired, but
  no job answers). Assert both are empty in a unit test.
- **Optional D1 lease.** `lease: { d1: (env) => env.DB, key?, ttlSeconds }`
  takes the lease with one conditional upsert (compare-and-swap) and releases it
  by lease id, so a cron run and a manual trigger sharing `key` cannot overlap.
  A run that finds it held returns
  `{ status: 'skipped', skipped: 'lease-held' }`. If the lease cannot be taken
  (for example, the table is missing), the job fails closed and does not run.
  Add `SCHEDULED_JOB_LEASES_SQL` (table `narduk_scheduled_job_leases`) to the
  app's migrations.
- **Plain Workers.** Call
  `ctx.waitUntil(runScheduledJobs(controller, env, jobs))` from `scheduled`.
  `runScheduledJobs` returns `{ cron, outcomes }`, one `succeeded`/`failed`/
  `skipped` entry per matched job.

It lives outside `server/utils`, so it adds no auto-imported names to an app.
Import it explicitly.

## Background work: `runInBackground` and `resolveWaitUntil`

`@narduk-enterprises/narduk-core/server/wait-until` keeps work alive past the
response (narduk-libs#991). On Workers, a promise the response does not wait on
can be cancelled once the response is sent, so a cache write or a stale refresh
must be handed to the runtime's `waitUntil`. Five apps resolved that function by
hand, and their copies disagreed on lookup order, binding and the fallback.

```ts
import { runInBackground } from '@narduk-enterprises/narduk-core/server/wait-until'

export default defineEventHandler(async (event) => {
  const response = await fetchTile(event)
  await runInBackground(event, cache.put(key, response.clone()), {
    onError: (error) =>
      log.warn('tile cache fill failed', { error: String(error) }),
  })
  return response
})
```

- **Lookup order.** Nitro's `event.waitUntil`, then the Cloudflare
  `ExecutionContext` at `event.context.cloudflare.context`, then
  `event.context.waitUntil`. Reading only `context.cloudflare.context` misses
  every preset but `cloudflare-module`.
- **Called as a method.** A detached `ExecutionContext.waitUntil` throws on
  Workers, so the resolver never pulls the function into a local.
- **Nitro internal fetch.** A `$fetch` to a local route during SSR gets an event
  with no `waitUntil` of its own. The resolver walks
  `event.context.nuxt.ssrContext.event` to the SSR parent.
- **No `waitUntil` at all** (dev, node presets, unit tests):
  `fallback: 'detach'` (the default) lets the task run on with its error handler
  attached; `fallback: 'await'` waits for it. Either way a rejection goes to
  `onError`, or to an `error` line on the request logger, and `runInBackground`
  itself never rejects.
- `resolveWaitUntil(event)` returns the bound function, or `null`, for code that
  passes a `waitUntil` into a lower layer (operator-portal's route helpers).

`withD1Cache` uses the same resolver for its stale-while-revalidate refresh. It
lives outside `server/utils`, so it adds no auto-imported names to an app (buoys
already declares a private `resolveWaitUntil`). Import it explicitly.

## Size-capped upstream reads: `readBoundedBody`

The published-data client (`fetchNardukDataJson`) reads artifact bytes through
`readBoundedBody`, and an app that reads any other upstream API can use it too.
(The app-owned `readBoundedBody` in the "before" example above was that app's
own helper, not this one.) It checks a declared `content-length`, then streams
the body and cancels the download once it passes `maxBytes`, so an upstream that
omits or understates its length cannot fill isolate memory. `response.text()`
followed by a length check buffers the whole body first, so it does not protect
anything.

```ts
const issues = await readBoundedJson<Issue[]>(response, 256 * 1024, {
  label: 'GitHub issues',
})
```

At the ceiling it throws `BoundedBodyTooLargeError`, which carries `maxBytes`.
Pass `tooLarge: () => new MyError(...)` to throw your own error instead. Both
functions are Nitro auto-imports, or import them from
`@narduk-enterprises/narduk-core/server/utils/boundedBody`.

## Inbound request bodies: what the Worker reads before a route runs

This is a security note, not an API. On the `cloudflare-module` preset that
narduk-core sets, Nitro reads the **whole** request body into memory before h3,
any Nitro plugin or middleware, or any route handler runs. So no byte ceiling in
this package, or in an app, can stop that first read (narduk-libs#458).

The read is in nitropack 2.13.4, in
`dist/presets/cloudflare/runtime/_module-handler.mjs`, in `fetchHandler`:

```js
if (requestHasBody(request)) {
  body = Buffer.from(await request.arrayBuffer())
}
```

`requestHasBody` looks only at the method (`POST`, `PUT` or `PATCH`), so neither
a missing nor a large `content-length` skips the read. Nitro's first runtime
hook, `request`, runs inside `nitroApp.localFetch`, which is reached only after
that read. The only earlier code is the preset's own `fetch` step, which serves
static assets and WebSocket upgrades, and nothing can add to it. Cloudflare's
`request.arrayBuffer()` waits for the full body; it does not stream.

**What bounds the read.** Only Cloudflare's edge. It refuses a request body over
the plan's maximum (100 MB on Free and Pro, more on Business and Enterprise)
before the Worker sees it. A Worker isolate has 128 MB of memory, so one body
near the edge limit can cost most of an isolate before any route can refuse it.

**What this package bounds.** Once the body is in memory, these ceilings limit
what gets parsed. They do not stop the read above:

- `defineValidatedHandler` answers 413 over `maxBodyBytes` (1 MiB by default).
  It checks a declared length before parsing and measures a chunked body after
  the read.
- The CSP report route (`/api/_security/csp-report`) answers 413 over 64 KiB.

**Why there is no Content-Length gate.** A check before the read would have to
run in the Worker's `fetch` export. Nitro 2 has no hook there. The only way to
add one is to replace the preset's entry with a wrapper that re-imports Nitro's
internal runtime file, or to rewrite that file at build time. Either one breaks
silently when the Nitro pin moves. It would also stop only a declared length: a
chunked upload has no `content-length` and would be read in full anyway. So the
cost of a wrapper outweighs what it would protect.

**When to re-test.** Check this again whenever the `nitropack` pin in this
package moves, and when the fleet moves to Nitro v3. On 2026-09-24, 2.13.4 was
the newest nitropack 2.x on npm. In the Nitro v3 beta checked that day
(`nitro@3.0.260903-beta`), the Cloudflare handler passes the `Request` itself to
`nitroApp.fetch(request)` and does not buffer it. On v3, handlers can therefore
stream the body and cancel it at a ceiling the way `readBoundedBody` does for
responses. At that point, move the ceilings above from after the read to during
it.

## Shared media components

Auto-registered from `runtime/app/components/shared/` (`addComponentsDir` with
`pathPrefix: false`), so an app that enables the module's `app` option gets
`AppLightbox`, `AppImage`, and `AppSnapStrip` without importing them.

### `AppLightbox`

Fullscreen image/video viewer. Escape closes it; without rails, ArrowLeft /
ArrowRight and the chevrons step the gallery. `v-model` is open/closed.

Optional `rails` (0–2 labelled thumbnail rows under the picture) each own a
keyboard axis: the first rail uses ArrowLeft / ArrowRight, the second uses
ArrowUp / ArrowDown. Choosing a thumb updates the main picture and emits
`select` with `{ railIndex, itemIndex }`. Rails are focusable, use the rail
label as `aria-label`, and mark the current thumb with `aria-current`. Omit
`rails` and existing keyboard / swipe behaviour is unchanged.

The named `side` slot receives `{ item, index }` for the current picture. It
renders beside the picture from the `md` breakpoint up, and below it on narrow
screens.

```vue
<AppLightbox
  v-model="open"
  :items="pictures"
  :rails="rails"
  @select="onRailSelect"
>
  <template #side="{ item, index }">
    <p>{{ item.caption }} · {{ index + 1 }}</p>
  </template>
</AppLightbox>
```

### `AppImage`

Wraps a remote `<img>`. A `USkeleton` covers the frame while it loads; a failed
load shows a hatched blank (`repeating-linear-gradient`) plus `failedText`
(default "Image unavailable"). Forwards `src`, `alt`, `width`, `height`,
`loading`, and `decoding`; emits `load` / `error`. Setup never reads `window`.
The skeleton shimmer is CSS and silent under `prefers-reduced-motion`.

```vue
<AppImage src="/stations/41002.jpg" alt="Buoy cam" failed-text="Cam offline" />
```

### `AppSnapStrip`

Horizontal CSS scroll-snap strip. Each default-slot child is one snap point.
`itemsPerView` defaults to 2 (the phone reading). The position readout uses an
en dash (`1–2 of 6`) from the children currently intersecting the scroller.
IntersectionObserver runs on the client only; SSR prints the first-page estimate
(`1 of N` or `1–2 of N`) without crashing. Previous / Next buttons page by the
visible width.

```vue
<AppSnapStrip :items-per-view="2">
  <figure v-for="picture in pictures" :key="picture.id">
    <AppImage :src="picture.src" :alt="picture.alt" />
  </figure>
</AppSnapStrip>
```

## Deprecated components

### `AppEmptyState` — deprecated, removed in the next major

Use `NeStatePanel` from `@narduk-enterprises/narduk-shell` instead
([narduk-libs#254](https://github.com/narduk-enterprises/narduk-libs/issues/254),
backlog item 7; standing decision D4, Logan 2026-09-11: "Deprecate, remove next
major"). `AppEmptyState` still behaves exactly as it did — this release changes
no runtime behaviour — but it will not survive the next narduk-core major.

`AppEmptyState` can only say "nothing here". It cannot tell **unknown** from
**zero**, which is the distinction the surfaces using it actually need, and the
bug class behind operator-portal
[#183](https://github.com/narduk-enterprises/operator-portal/issues/183),
[#162](https://github.com/narduk-enterprises/operator-portal/issues/162),
[#100](https://github.com/narduk-enterprises/operator-portal/issues/100) and
[#21](https://github.com/narduk-enterprises/operator-portal/issues/21).
`NeStatePanel` carries five readings — `empty`, `loading`, `error`, `blocked`,
`absent` — gives each the right ARIA role by construction, and never signals the
reading with colour alone.

The props map one for one:

| `AppEmptyState`         | `NeStatePanel`                                     |
| ----------------------- | -------------------------------------------------- |
| (implicit empty)        | `state="empty"`                                    |
| `title`                 | `title`                                            |
| `description`           | `message`                                          |
| `icon`                  | `icon`                                             |
| default slot (a button) | `#action` slot                                     |
| `compact`               | no equivalent; pass `class` or `ui` if you need it |

```vue
<!-- before -->
<AppEmptyState
  icon="i-lucide-inbox"
  title="No invoices yet"
  description="Create your first invoice to get started."
>
  <UButton to="/invoices/new" icon="i-lucide-plus">Create invoice</UButton>
</AppEmptyState>

<!-- after -->
<NeStatePanel
  state="empty"
  icon="i-lucide-inbox"
  title="No invoices yet"
  message="Create your first invoice to get started."
>
  <template #action>
    <UButton to="/invoices/new" icon="i-lucide-plus">Create invoice</UButton>
  </template>
</NeStatePanel>
```

A migrating app also gains `loading`, `error`, `blocked` and `absent` for free,
plus the `gaps` / `unblocksOn` vocabulary — see
[narduk-shell's README](../../design/narduk-shell/README.md#nestatepanel).

A one-time, **dev-only** `console.warn` points at `NeStatePanel` the first time
`AppEmptyState` is set up in a development process. Production stays silent, and
the empty-state markup is unchanged. The `@deprecated` JSDoc on the component
gives editors and `vue-tsc` the strike-through and the same pointer.

### `AppConfirmModal` — deprecated, removed in the next major

Superseded by `NeConfirmDialog` and `useConfirm()` in
[`@narduk-enterprises/narduk-shell`](../../design/narduk-shell/README.md#neconfirmdialog--useconfirm)
(components backlog item 16,
[narduk-libs#263](https://github.com/narduk-enterprises/narduk-libs/issues/263);
decision D4, 2026-09-11: deprecate now, remove in the next narduk-core major).

Behaviour is unchanged in this release — the component still works exactly as it
did. A one-time, dev-only `console.warn` points at `NeConfirmDialog` /
`useConfirm()` the first time the component is used. New code should use the
suite; existing call sites can migrate at their own pace before the next major.

**Migration mapping**

| `AppConfirmModal`              | `NeConfirmDialog`                | Notes                                                                                                         |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `v-model`                      | `v-model:open`                   | Nuxt UI v4's overlay model; the `narduk/no-legacy-overlay-model` lint rule already wants this spelling.       |
| `title`                        | `title`                          | Same default (`Are you sure?`).                                                                               |
| `message`                      | `message`                        | Now also the dialog's `aria-describedby` target.                                                              |
| `confirmLabel` / `cancelLabel` | `confirmLabel` / `cancelLabel`   | Same defaults.                                                                                                |
| `confirmColor="error"`         | `tone="danger"`                  | Also moves initial focus to Cancel. `confirmColor` was `error` by default; `tone` is `default` by default.    |
| `confirmColor` (other values)  | `tone="default"`                 | The suite offers two tones deliberately. A one-off colour is a sign the dialog is doing more than confirming. |
| `loading`                      | `pending`                        | Additionally disables cancel and turns off Escape / outside-click dismissal (`preventClose`).                 |
| `dismissible`                  | — (derived)                      | Dismissal is on unless `pending`; there is no separate switch.                                                |
| `icon` / icon tone             | — (dropped)                      | The tone colours the confirm button instead. Put an icon in the body if a call site genuinely needs one.      |
| default slot                   | `#body` slot, or the `body` prop | `AppConfirmModal`'s default slot landed in `UModal`'s trigger slot; `#body` puts it in the dialog body.       |
| `@confirm` / `@cancel`         | `@confirm` / `@cancel`           | Unchanged, including that `@confirm` deliberately leaves the dialog open.                                     |

Most call sites are better off dropping the markup entirely:

```ts
const confirm = useConfirm()
if (
  !(await confirm({
    title: 'Delete invoice?',
    message: 'This cannot be undone.',
    tone: 'danger',
  }))
) {
  return
}
```

### `AppSettingsProfile` — deprecated, removed in the next major

Superseded by `NeSettingsPage` (with `NeForm` and `NeFormSection`) in
[`@narduk-enterprises/narduk-shell`](../../design/narduk-shell/README.md#nesettingspage)
(components backlog item 19,
[narduk-libs#266](https://github.com/narduk-enterprises/narduk-libs/issues/266);
decision D4, 2026-09-11: deprecate now, remove in the next narduk-core major).

Behaviour is unchanged in this release — the component still works exactly as it
did. A one-time, dev-only `console.warn` points at `NeSettingsPage` the first
time the component is used. New code should use the suite; existing call sites
can migrate at their own pace before the next major.

`AppSettingsProfile` bundled a fixed profile card — name, email, an avatar
uploader, and a "quick links" sidebar — with no schema validation, no protection
against a double-click firing `@save` twice, and a `saving` prop the caller has
to wire and flip by hand. `NeSettingsPage` composes `NeForm`'s save bar (one
submit per click, a loading button with no ref to wire, dirty state that only
clears once the save resolves) with one or more titled `NeFormSection`s, so a
settings screen states its own fields instead of fitting inside one fixed card
shape.

**Migration mapping**

| `AppSettingsProfile`                         | `NeSettingsPage` / `NeForm` / `NeFormSection`            | Notes                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `title` / `subtitle`                         | `title` (on `NeSettingsPage`)                            | The suite has one title, not a title/subtitle pair; put the subtitle in `description` if it is a sentence.             |
| `initial-name`, `email`, ...                 | `state` (a reactive object)                              | `NeSettingsPage`/`NeForm` are controlled: pass a `reactive()` object and bind fields to it with `UFormField`/`UInput`. |
| `@save="handleSave"`                         | `@submit` (via the `onSubmit` prop, called `:on-submit`) | Fires once per click and disables the button for the promise's duration — no `:saving` prop to wire by hand.           |
| `saving` prop                                | — (automatic)                                            | `UButton`'s own `loading-auto` drives this from the `onSubmit` promise; nothing to pass in.                            |
| avatar upload (`show-avatar`, cropping, ...) | — (dropped)                                              | Not part of the suite. Keep a bespoke avatar uploader as a field inside a `NeFormSection` if a call site needs one.    |
| `settings-links` / `#settings-sidebar` slot  | — (dropped)                                              | Page-level navigation is an app concern; render it around `NeSettingsPage`, not inside it.                             |
| `#extra-fields` slot                         | the default slot, inside a `NeFormSection`               | Add fields as `UFormField`s inside one or more sections rather than one fixed slot.                                    |

```vue
<!-- before -->
<AppSettingsProfile
  :initial-name="user.name"
  :email="user.email"
  :saving="isSaving"
  @save="handleSave"
/>

<!-- after -->
<script setup lang="ts">
const state = reactive({ name: user.name })
async function handleSave(data: { name: string }) {
  await saveProfile(data)
}
</script>

<template>
  <NeSettingsPage title="Your identity" :state="state" :on-submit="handleSave">
    <NeFormSection title="Profile">
      <UFormField name="name" label="Display name">
        <UInput v-model="state.name" />
      </UFormField>
      <UFormField name="email" label="Email">
        <UInput :model-value="user.email" disabled />
      </UFormField>
    </NeFormSection>
  </NeSettingsPage>
</template>
```

### `LayerAppShell`, `LayerChromelessShell` and `LayerDashboardShell` — deprecated, removed in the next major

Superseded by `NeAppShell` and `useNardukShellSections()` in
[`@narduk-enterprises/narduk-shell`](../../design/narduk-shell/README.md#neappshell)
(components backlog item 18,
[narduk-libs#265](https://github.com/narduk-enterprises/narduk-libs/issues/265);
decision D4: deprecate now, remove in the next narduk-core major).

Behaviour is unchanged in this release: all three render exactly as they did,
and core's own `app.vue` and `dashboard` layout (and narduk-auth's `auth` and
`blank` layouts) keep using them. There is deliberately **no** runtime warning,
unlike the other deprecations above: an app gets these shells from core's own
`app.vue` and layouts without ever naming them, so a warning would blame apps
that made no choice. The `@deprecated` JSDoc on each component gives editors and
`vue-tsc` the strike-through and the pointer.

`NeAppShell` is opt-in: it is not registered as a layout and nothing scaffolds
it. An app migrates by writing it in its own layout.

**Migration mapping**

| Before                                      | `NeAppShell`                           | Notes                                                                                                      |
| ------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `LayerDashboardShell` `navItems`            | `sections` (or `nardukShell.sections`) | A flat list becomes one or more labelled sections: `[{ id, label, items: [{ label, to, icon }] }]`.        |
| `app.config.dashboard.navItems`             | `useNardukShellSections()`             | Shared, SSR-safe state seeded from `nardukShell.sections`; mutate it to add a section at runtime.          |
| `navItems[].requiresAdmin`                  | — (the app's own logic)                | The shell does no auth. Push the admin section into `useNardukShellSections()` when the session allows it. |
| sidebar collapse / resize / `sidebarSizing` | — (dropped)                            | The rail is always expanded at a fixed 14.5rem; below `lg` it is a drawer.                                 |
| header logo and app name                    | `#rail-top`                            |                                                                                                            |
| `#sidebar-footer` / account menu            | `#rail-bottom`                         | Put `LayerDashboardAccountMenu` (or the app's own) here.                                                   |
| `#sidebar-info`, `description`              | — (dropped)                            | Put copy in `#rail-bottom` if it is still needed.                                                          |
| `#navbar-right`, `statusBadges`             | `#navbar-right`                        | Badges become the app's own markup in the slot.                                                            |
| breadcrumbs in the navbar                   | `#navbar`                              | Render `UBreadcrumb` (or `NePageHeader`'s breadcrumbs) yourself.                                           |
| default slot                                | default slot                           | Rendered inside the shell's `<main>`, with a skip link to it.                                              |
| `LayerAppShell` skip link and `<main>`      | built in                               | `UApp` is not part of the shell: keep it in the app's `app.vue`.                                           |
| `LayerAppShell` `#header` / `#footer`       | — (none today)                         | Page header / footer framing around the shell is an open question, tracked in narduk-libs#389.             |
| `LayerChromelessShell`                      | — (no shell)                           | A chromeless layout (auth, blank) simply does not render `NeAppShell`.                                     |
