# @narduk-enterprises/narduk-analytics

PostHog, Google Analytics 4 (GA4), Google Search Console (GSC), and IndexNow
Nuxt **module** for Narduk Cloudflare apps. It ships client-side analytics
loading, an owner-traffic tagging flow, admin dashboards for GA/GSC/PostHog,
Google Indexing API helpers, and IndexNow key verification/submission.

## Requires `@narduk-enterprises/narduk-core`

This module has a hard runtime dependency on
[`@narduk-enterprises/narduk-core`](../narduk-core): the client plugins
(`posthog.client`, `gtag.client`, `analytics-head.client`) declare
`dependsOn: ['runtime-public']` and read `posthogPublicKey`, `gaMeasurementId`,
`deploymentTarget`, and `previewSafeMode` from the **runtime-public overlay**
that only `narduk-core`'s `00-runtime-public.client` plugin and
`/api/runtime/public` route provide
(`packages/modules/narduk-core/runtime/server/utils/runtime-public.ts`).

If `narduk-core` is not already installed, this module **installs it
automatically** during `setup()` so analytics still works — you do not need to
list it explicitly, though doing so (and listing it first) remains the
documented, supported shape used across the fleet:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    '@narduk-enterprises/narduk-core/nuxt',
    '@narduk-enterprises/narduk-seo/nuxt', // optional
    '@narduk-enterprises/narduk-analytics/nuxt',
  ],
})
```

Being registered is not enough: narduk-core registers the overlay only when its
own `app` option is on (the default). With `nardukCore: { app: false }`, or
`app: false` in an inline narduk-core module tuple, the client plugins would run
with no key and send nothing. So the build fails with that shape unless
`nardukAnalytics.app` is `false` too, which keeps only the server half
(narduk-libs#663).

## Module options

Configure under the `nardukAnalytics` key (or pass inline module options):

```ts
export default defineNuxtConfig({
  modules: [
    '@narduk-enterprises/narduk-core/nuxt',
    '@narduk-enterprises/narduk-analytics/nuxt',
  ],
  nardukAnalytics: {
    app: true, // register composables/components/plugins (default: true)
    server: true, // register server routes/middleware (default: true)
  },
})
```

## Strict privacy mode (private apps)

For an app whose pages hold private records — signed-in farm, finance or health
data, invitation links — set the build-time option:

```ts
export default defineNuxtConfig({
  nardukAnalytics: { privacy: 'strict' },
})
```

`standard` (the default) is unchanged. `strict` changes what leaves the browser:

| Surface                                          | Standard                                  | Strict                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostHog `$pageview` URL                          | raw path (`/farms/frm_1/2024`)            | route pattern (`/farms/:farmId/:year`)                                                                                                                                                                                                                    |
| Every other PostHog URL                          | raw `window.location.href`, query and `#` | a final `before_send` hook reduces every `$…url`, `$…referrer` and `$…pathname` property — including `$set`, `$set_once` and nested web-vitals payloads — to the route pattern; another site's URL is cut to its origin; `title` and element text dropped |
| Autocapture, rage/dead clicks                    | PostHog defaults (autocapture on)         | off, plus `mask_all_text` / `mask_all_element_attributes`                                                                                                                                                                                                 |
| Heatmaps                                         | PostHog project setting decides           | off                                                                                                                                                                                                                                                       |
| Session replay, surveys                          | `POSTHOG_*_ENABLED` flags                 | off, whatever the flags say                                                                                                                                                                                                                               |
| `/flags` request, remote extensions              | on                                        | off (`advanced_disable_flags`, `disable_external_dependency_loading`)                                                                                                                                                                                     |
| Web-vitals attribution                           | `POSTHOG_WEB_VITALS_ATTRIBUTION_ENABLED`  | off (it carries element selectors and resource URLs); plain web vitals still allowed                                                                                                                                                                      |
| `$exception` message                             | raw `error.message` in `$exception_list`  | narduk-core's `redacted_message` only                                                                                                                                                                                                                     |
| GA4 `page_path` / `page_location` / `page_title` | raw path, `document.title`                | route pattern for all three, also set with `gtag('set')` so tag-collected events inherit it; `page_referrer` cut to origin; Google signals and ad personalisation off                                                                                     |

Why build-time: the option is written to `runtimeConfig.public.analyticsPrivacy`
and wins over an app's own value for that key. narduk-core's runtime-public
overlay does not carry it, so no Worker variable can switch a strict app back to
standard — unlike the `POSTHOG_*_ENABLED` flags, which the overlay reads per
request.

What strict does **not** do, and what the operator still owns:

- It cannot stop data an app puts in its own `usePosthog().capture()`
  properties, other than URL-shaped `$…` keys. Capture event names and
  low-cardinality properties only.
- Turn off the GA4 web stream's **Enhanced measurement** (or at least "Page
  changes based on browser history events", "Site search" and "Form
  interactions"); Google collects those itself.
- In PostHog project settings, turn on **Discard client IP data** and leave
  session replay, heatmaps and autocapture off at the project level too.
- Keep private routes out of the sitemap and IndexNow submissions; this module
  submits only what it is given.

## Runtime config (env vars)

All keys below are read once at build/start time via `process.env` in
`src/module.ts` unless noted otherwise. Server-side Google/PostHog admin routes
additionally support Worker-runtime-secret overrides (Cloudflare binding/secret
takes priority over the build-time value) via narduk-core's `readRuntimeString`
— see each route for its specific env var name.

### Public (client-visible) config

| Env var                                                              | `runtimeConfig.public` key                | Default                    | Purpose                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NUXT_PUBLIC_ANALYTICS_LOAD_STRATEGY` / `ANALYTICS_LOAD_STRATEGY`    | `analyticsLoadStrategy`                   | `idle`                     | `immediate` \| `idle` \| `interaction` \| `off` — when client analytics scripts load.                                                                                                                                                                                                                                                                              |
| `GA_MEASUREMENT_ID`                                                  | `gaMeasurementId`                         | `''`                       | GA4 measurement ID (`G-XXXXXXX`). Empty disables `gtag.client`.                                                                                                                                                                                                                                                                                                    |
| `POSTHOG_HOST`                                                       | `posthogHost`                             | `https://us.i.posthog.com` | PostHog ingestion host.                                                                                                                                                                                                                                                                                                                                            |
| `POSTHOG_DEAD_CLICKS_ENABLED`                                        | `posthogDeadClicksEnabled`                | `false`                    | Enables PostHog dead-click autocapture.                                                                                                                                                                                                                                                                                                                            |
| `POSTHOG_EXTERNAL_DEPENDENCY_LOADING_ENABLED`                        | `posthogExternalDependencyLoadingEnabled` | `false`                    | Allows PostHog to load its own external dependencies (e.g. for surveys) when session replay is off.                                                                                                                                                                                                                                                                |
| `POSTHOG_FEATURE_FLAGS_ENABLED`                                      | `posthogFeatureFlagsEnabled`              | `false`                    | Enables PostHog feature flags.                                                                                                                                                                                                                                                                                                                                     |
| `POSTHOG_SESSION_REPLAY_ENABLED`                                     | `posthogSessionReplayEnabled`             | `false`                    | Enables PostHog session replay recording when explicitly set to `true`.                                                                                                                                                                                                                                                                                            |
| `POSTHOG_SURVEYS_ENABLED`                                            | `posthogSurveysEnabled`                   | `false`                    | Enables PostHog surveys and their automatic display.                                                                                                                                                                                                                                                                                                               |
| `POSTHOG_WEB_VITALS_ENABLED`                                         | `posthogWebVitalsEnabled`                 | `false`                    | Enables Core Web Vitals reporting (`$web_vitals`). See below.                                                                                                                                                                                                                                                                                                      |
| `POSTHOG_WEB_VITALS_ATTRIBUTION_ENABLED`                             | `posthogWebVitalsAttributionEnabled`      | `false`                    | Adds web-vitals attribution debug data. Ignored unless web vitals are enabled.                                                                                                                                                                                                                                                                                     |
| `NUXT_PUBLIC_INDEXNOW_KEY`                                           | `indexNowKey`                             | `''`                       | Public IndexNow key, used by the client-visible config surface (see also the private key below).                                                                                                                                                                                                                                                                   |
| `POSTHOG_PUBLIC_KEY` (Worker env, read per request by `narduk-core`) | `posthogPublicKey`                        | `''`                       | PostHog **project API key** (`phc_…`). Without it, `posthog.client` no-ops. narduk-core's runtime-public overlay reads the bare Worker variable or secret on every request, falling back to `runtimeConfig.public.posthogPublicKey` — which exists only if the app declares it (`posthogPublicKey: process.env.POSTHOG_PUBLIC_KEY \|\| ''`); this module does not. |
| `NARDUK_DEPLOY_TARGET` (read by `narduk-core`)                       | `deploymentTarget`                        | `production`               | `production` \| `staging` \| `preview`. Drives the `is_internal_user`/`environment` PostHog super-properties (see below). A `*.workers.dev` / `*.pages.dev` request host is always `preview`.                                                                                                                                                                      |
| `NARDUK_PREVIEW_SAFE_MODE` (read by `narduk-core`)                   | `previewSafeMode`                         | `false`                    | True whenever the resolved target is not `production`, or when set. All client analytics plugins no-op, and the overlay blanks `posthogPublicKey` and `gaMeasurementId`.                                                                                                                                                                                           |

### Private (server-only) config

| Env var                                                                                                | `runtimeConfig` key       | Purpose                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OWNER_TAG_SECRET`                                                                                     | `ownerTagSecret`          | Shared secret required by `POST /api/owner-tag` to set/clear the owner cookies. Also the HMAC key for the httpOnly owner-proof cookie that bootstrap verifies.  |
| `POSTHOG_OWNER_DISTINCT_ID`                                                                            | `posthogOwnerDistinctId`  | Optional PostHog distinct ID shared across your own devices; served by `GET /api/owner/posthog-bootstrap` only after the signed owner-proof cookie verifies.    |
| `NUXT_INDEXNOW_KEY` / `INDEXNOW_KEY`                                                                   | `indexNowKey`             | Private IndexNow key fallback, checked before the public key. Also readable from the Worker runtime env directly (`INDEXNOW_KEY` / `NUXT_PUBLIC_INDEXNOW_KEY`). |
| `GA_PROPERTY_ID` (Worker runtime env; falls back to `runtimeConfig.gaPropertyId`)                      | `gaPropertyId`            | GA4 property ID for the admin GA overview route.                                                                                                                |
| `GSC_SITE_URL` (Worker runtime env; falls back to `runtimeConfig.gscSiteUrl`)                          | `gscSiteUrl`              | Search Console site URL/domain property (e.g. `sc-domain:example.com`); falls back to a `sc-domain:` derived from `appUrl` when unset.                          |
| `GSC_SERVICE_ACCOUNT_JSON` (Worker runtime env; falls back to `runtimeConfig.googleServiceAccountKey`) | `googleServiceAccountKey` | Google service-account JSON (plain or base64) used to mint GA/GSC/Indexing API JWTs (`server/utils/google.ts`).                                                 |
| `POSTHOG_PERSONAL_API_KEY` (Worker runtime env; falls back to `runtimeConfig.posthogApiKey`)           | `posthogApiKey`           | PostHog **personal** API key for admin HogQL queries and session-recording listing.                                                                             |
| `POSTHOG_PROJECT_ID` (Worker runtime env; falls back to `runtimeConfig.posthogProjectId`)              | `posthogProjectId`        | PostHog project ID for admin queries.                                                                                                                           |
| `POSTHOG_API_HOST` (Worker runtime env; falls back to `runtimeConfig.posthogApiHost`)                  | `posthogApiHost`          | PostHog **API** host for admin queries (defaults to `https://p.nard.uk`; distinct from the client ingestion `posthogHost`).                                     |
| `POSTHOG_DOMAIN` (Worker runtime env; falls back to `runtimeConfig.posthogDomain`)                     | `posthogDomain`           | Domain filter applied to admin HogQL page/referrer/device queries; derived from `appUrl` when unset.                                                            |

## Composables

- `usePosthog()` — `{ client, capture, identify, reset }`. Prefer this over
  `window.$nuxt.$posthog` or a raw `posthog-js` import: every method no-ops when
  analytics is disabled (no key, SSR, localhost, preview-safe mode, or
  `analyticsLoadStrategy: 'off'`).
- `useAdminGaOverview(options?)` — `useAsyncData` wrapper around
  `GET /api/admin/ga/overview`. Accepts reactive `startDate`/`endDate`.
- `useAdminGscPerformance(options?)` — `useAsyncData` wrapper around
  `GET /api/admin/gsc/performance`. Accepts reactive
  `dimension`/`startDate`/`endDate`.
- `useAdminPosthogDashboard(options?)` — Fetches pages, referrers, devices,
  entry/exit, insights, and recordings in parallel; returns each as its own
  `useAsyncData` plus `refreshAll()`.

## Components

- `AdminAnalyticsDashboard` — top-level admin dashboard composing the panels
  below.
- `AdminGaOverviewPanel`, `AdminGscPerformancePanel`, `AdminPosthogPanel` —
  individual admin panels, importable standalone.

## Server routes

All `/api/admin/**` routes require an authenticated admin session
(`requireAdmin` from `narduk-core`). Write routes (`indexing`, `submit-sitemap`)
additionally 403 when `previewSafeMode` is active
(`assertAnalyticsWriteAllowed`).

`requireAdmin` resolves the admin through the auth session **and the app's
database**, so on an app without one these routes could only ever answer 401.
They therefore register only when the app has a database: an app that declares
`nardukCore.databaseBackend: 'none'` (or builds with
`NUXT_DATABASE_BACKEND=none`) gets none of them, and neither the admin
composables nor the dashboard components have anything to call. Set
`nardukAnalytics.admin: true` or `false` to decide outright. A DB-less app that
wants its GSC and PostHog numbers reads them outside the app for now
(narduk-libs#524). The handlers live in `server/admin/api/admin/**`, a scan dir
the module adds only when admin is on.

| Route                           | Method       | Purpose                                                                                                                                     |
| ------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/owner-tag`                | `POST`       | Set/clear `narduk_owner` (client-readable flag) and the httpOnly HMAC proof cookie. Requires `OWNER_TAG_SECRET`.                            |
| `/api/owner/posthog-bootstrap`  | `GET`        | Returns `POSTHOG_OWNER_DISTINCT_ID` for cross-device identity after the HMAC proof cookie verifies. Rate-limited with the owner-tag policy. |
| `/api/indexnow/submit`          | `POST`       | Submits URLs (default: homepage + sitemap) via the IndexNow protocol.                                                                       |
| `/{key}.txt` (middleware)       | `GET`/`HEAD` | Serves the configured IndexNow key at its verification path.                                                                                |
| `/api/admin/ga/overview`        | `GET`        | GA4 totals + daily rows for a date range (`startDate`, `endDate`, `noCache`).                                                               |
| `/api/admin/gsc/performance`    | `GET`        | GSC search-performance rows by dimension (`query`/`page`/`device`/`country`/`searchAppearance`).                                            |
| `/api/admin/gsc/sitemaps`       | `GET`        | Lists submitted sitemaps and their indexing counts.                                                                                         |
| `/api/admin/gsc/submit-sitemap` | `POST`       | Submits a sitemap URL to Search Console.                                                                                                    |
| `/api/admin/gsc/inspect-url`    | `POST`       | Runs a Search Console URL Inspection.                                                                                                       |
| `/api/admin/indexing/batch`     | `POST`       | Google Indexing API — batch-publish up to 100 URL notifications.                                                                            |
| `/api/admin/indexing/publish`   | `POST`       | Google Indexing API — publish a single URL notification.                                                                                    |
| `/api/admin/indexing/status`    | `GET`        | Google Indexing API — last notification status for a URL.                                                                                   |
| `/api/admin/posthog/pages`      | `GET`        | Top pages by pageviews for a period.                                                                                                        |
| `/api/admin/posthog/referrers`  | `GET`        | Top referrers for a period.                                                                                                                 |
| `/api/admin/posthog/devices`    | `GET`        | Device/browser breakdown for a period.                                                                                                      |
| `/api/admin/posthog/entry-exit` | `GET`        | Top entry/exit pages for a period.                                                                                                          |
| `/api/admin/posthog/insights`   | `GET`        | Arbitrary HogQL-backed insight results for a period.                                                                                        |
| `/api/admin/posthog/recordings` | `GET`        | Recent session recordings (up to `limit`).                                                                                                  |

## IndexNow

`notifyIndexNow()` (`server/utils/indexNow.ts`) and `POST /api/indexnow/submit`
submit URLs to the shared [IndexNow](https://www.indexnow.org/) endpoint,
`https://api.indexnow.org/indexnow`. The route sits behind narduk-core's CSRF
middleware, so a manual call needs `X-Requested-With`:

```sh
curl -sS -X POST https://<site>/api/indexnow/submit \
  -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' \
  -d '{"urls":["https://<site>/"]}'
# → {"submitted":1,…,"results":[{"engine":"https://api.indexnow.org/indexnow","status":200,"ok":true}]}
```

`api.indexnow.org` answers `200` (accepted) or `202` (accepted, key not yet
validated); `403` means the key file does not match, `422` means a URL is not on
the key's host. The route is a public, rate-limited mutation that accepts any
URL list, so an app that must never announce a URL decides what it submits.
Search engines that participate in the IndexNow protocol (Bing, Yandex,
Seznam.cz, Naver, and others) share this index, so a single submission to
`api.indexnow.org` typically propagates to all of them — but that propagation is
between the participating engines, not a direct ping this module makes to each
one. Requires `INDEXNOW_KEY` (or `NUXT_PUBLIC_INDEXNOW_KEY`) to be set; the same
key is served back at `/{key}.txt` for ownership verification.

## Owner and preview traffic tagging

`posthog.client` registers PostHog super-properties on every event so you can
filter yourself and non-production traffic out of dashboards (Project Settings →
"Filter out internal and test users"):

- `is_owner` — set via the unsigned `narduk_owner=true` cookie
  (`POST /api/owner-tag`). That flag stays readable by `posthog.client`.
  Cross-device identity (`GET /api/owner/posthog-bootstrap`) additionally
  requires the httpOnly HMAC proof cookie minted with `OWNER_TAG_SECRET`
  (`narduk_owner_proof` on HTTP, `__Host-narduk_owner_proof` on HTTPS). The
  proof is `iat.hex(HMAC-SHA256(secret, narduk-owner-proof:v2:iat))` and is
  rejected after `OWNER_PROOF_MAX_AGE_SECONDS` (one year) or if it is the
  previous static v1 64-hex format — re-run `POST /api/owner-tag` once per owner
  device. Forging the flag cookie alone does not release
  `POSTHOG_OWNER_DISTINCT_ID`. Clearing the tag deletes both cookies.
- `is_internal_user` — set for any request whose deployment target
  (`runtimeConfig.public.deploymentTarget`) is not `production`, or whose
  hostname ends in `.pages.dev` or `.workers.dev` (covers both legacy Pages
  previews and the Workers-first fleet's preview aliases).
- `environment` — `development` (localhost), the resolved `deploymentTarget`
  when it is `staging`/`preview`, `preview` for a `.pages.dev`/`.workers.dev`
  hostname with no explicit deployment target, or `production` otherwise.
- `app_version` — from `runtimeConfig.public.appVersion` when set.

## Analytics load strategy

`analyticsLoadStrategy` (env `NUXT_PUBLIC_ANALYTICS_LOAD_STRATEGY` /
`ANALYTICS_LOAD_STRATEGY`, default `idle`) controls when `gtag.client` and
`posthog.client` initialize:

- `immediate` — runs synchronously on plugin setup.
- `idle` — waits for `requestIdleCallback` (falls back to a 1.5s timeout).
- `interaction` — waits for the first
  `pointerdown`/`keydown`/`scroll`/`touchstart`.
- `off` — disables both plugins entirely.

`00-analytics-head.client` additionally preconnects to the PostHog/GA origins
when the strategy is `immediate`.

## Core Web Vitals

Off by default, like every other PostHog capture feature in this module. Turn it
on per app:

```ts
// nuxt.config.ts
runtimeConfig: {
  public: {
    posthogWebVitalsEnabled: true,
  },
},
```

or set `POSTHOG_WEB_VITALS_ENABLED=true` in the build environment.

This is **PostHog's own `$web_vitals` autocapture**, not a second pipeline.
`posthog-js` ships a `webVitalsAutocapture` extension that buffers metrics and
emits one `$web_vitals` event carrying `$web_vitals_<METRIC>_value` and
`$web_vitals_<METRIC>_event` properties; enabling it is
`capture_performance: { web_vitals: true }`, which `posthog.client` now sets
from the flag above. PostHog's built-in Web Vitals dashboard reads the same
event, so it works with no further setup.

One thing does need help. The extension does not bundle the measurement code: it
fetches `/static/web-vitals.js` from the PostHog host unless
`window.__PosthogExtensions__.postHogWebVitalsCallbacks` is already populated —
and that fetch is refused whenever `disable_external_dependency_loading` is set,
which is this module's default whenever session replay is off. So
`posthog.client` publishes those callbacks itself, from the pinned `web-vitals`
package (the same library, and the same object PostHog's own asset publishes)
before calling `posthog.init`. Net effect: no extra network request, no change
to the module's external-dependency posture, and no roll-your-own collector.

### Metrics

`SupportedWebVitalsMetrics` in `posthog-js` is exactly `LCP | CLS | FCP | INP`,
and all four are captured. **TTFB is not available** — PostHog's autocapture
does not support it, and adding it would mean a second, parallel event stream.

### Properties added by this module

`posthog.client` installs a `before_send` hook that enriches `$web_vitals`
events only; every other event passes through untouched.

| Property                    | Example         | Notes                                                                                                                                                                                        |
| --------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `route`                     | `/stations/:id` | The **matched route pattern**, resolved from the URL recorded with the metric. Never a raw path, so record ids and slugs stay out of PostHog. `(unmatched)` when the router cannot match it. |
| `build_version`             | `a1b2c3d4e5f6`  | Deployed commit SHA, from narduk-core's `runtimeConfig.public.buildVersion`. Omitted when unset.                                                                                             |
| `connection_effective_type` | `4g`            | `navigator.connection.effectiveType`, where the browser exposes it.                                                                                                                          |
| `connection_save_data`      | `false`         | `navigator.connection.saveData`, where the browser exposes it.                                                                                                                               |
| `device_memory_gb`          | `8`             | `navigator.deviceMemory`, where the browser exposes it.                                                                                                                                      |
| `cpu_cores`                 | `10`            | `navigator.hardwareConcurrency`, where the browser exposes it.                                                                                                                               |

The app id needs no extra property: the `app` super property (plus
`environment`, `is_internal_user`, `is_owner`, and `app_version`) is already
registered on every event — see "Owner and preview traffic tagging" above.

The route is resolved from the `$current_url` stamped on the nested metric
payload rather than the event's own `$current_url`, because PostHog buffers
before capturing and the page can change in between.

### Batching and delivery

Batching is PostHog's: buffered metrics are captured as one `$web_vitals` event
when the URL changes, when every allowed metric has arrived, or after
`web_vitals_delayed_flush_ms` (5s default). The `web-vitals` library finalizes
CLS and INP when the page is hidden, so those normally arrive last and complete
the batch. A caveat worth knowing: if the document is discarded before that
timer fires and fewer than all four metrics are buffered, the batch is lost.
That is upstream behavior, shared with every PostHog project using
`$web_vitals`.

### When nothing is captured

Web vitals inherit every existing analytics gate — PostHog is never initialized
at all when the app is in preview safe mode, has no `posthogPublicKey`, is on a
local development host, or sets `analyticsLoadStrategy: 'off'`, so no vitals are
collected in any of those states. On top of that,
`capture_performance.web_vitals` is pinned explicitly to `false` when the flag
is off, so a PostHog project-side `capturePerformance` remote config cannot
start collecting vitals for an app that has not opted in.

### Attribution

`POSTHOG_WEB_VITALS_ATTRIBUTION_ENABLED` / `posthogWebVitalsAttributionEnabled`
switches to the `web-vitals/attribution` build, which adds debugging detail such
as the element responsible for a layout shift. It roughly doubles the size of
the lazily-imported web-vitals chunk, so it is off by default and best used
while investigating a specific regression.

### Dashboard

See
[PostHog Core Web Vitals dashboard per app](../../../docs/operations/posthog-web-vitals-dashboard.md)
for the per-app dashboard recipe.

## Exception reporting

`posthog-exceptions.client` subscribes PostHog to narduk-core's
`narduk:exception` seam. This module registers a **destination**; it installs no
error listeners of its own — the capture sites (`vue:error`, `app:error`, and
Nitro's `error` hook) belong to narduk-core.

Exceptions are captured through `posthog.captureException()`, PostHog's own
documented API, which emits the same `$exception` event exception autocapture
emits, so PostHog's Error tracking UI works with no further setup.

### Why not `capture_exceptions`

`capture_exceptions` autocapture is an _externally loaded_ extension: the bundle
calls
`__PosthogExtensions__.loadExternalDependency(instance, 'exception-autocapture', …)`,
and that loader refuses to run whenever `disable_external_dependency_loading` is
set — this module's default posture whenever session replay is off, exactly as
with `$web_vitals`. Setting `capture_exceptions: true` would therefore be a
switch that silently does nothing. `captureException()` is bundled in the main
`posthog-js` module, so it works under that posture unchanged.

### Properties

Every property is low cardinality and carries no identifier. The app id rides
along as the `app` super property `posthog.client` registers.

| Property           | Value                                               |
| ------------------ | --------------------------------------------------- |
| `route`            | Matched route **pattern**, never a raw path         |
| `source`           | `client` or `server`                                |
| `status_code`      | HTTP status the error carried, or 500               |
| `fatal`            | Whether the error took down the app                 |
| `redacted_message` | Message with query strings and emails removed       |
| `build_version`    | Deployed commit SHA, when known                     |
| `request_id`       | Correlation id, the same one `x-request-id` carries |

### When nothing is captured

Nothing is reported when analytics never initialized — no `posthogPublicKey`,
`previewSafeMode`, localhost, or `analyticsLoadStrategy: 'off'` — or when the
visitor has opted out of capture (`has_opted_out_capturing()`). Server-side
errors are recorded by narduk-logging as the request summary; this module adds
no server pipeline, because a Cloudflare Worker has no PostHog server SDK here
and a hand-rolled HTTP capture path would be exactly the second pipeline the
module avoids.

## GA4 pageviews

`gtag.client` configures the Google tag once with `send_page_view: false`, then
emits one manual `page_view` after the initial route is ready and after each
successful path change. The event uses the route pathname only, so query values
and hash fragments do not reach GA and query-only/hash-only navigation does not
create another pageview.

This module owns those GA4 pageviews. Keep the stream's Enhanced Measurement
`pageChangesEnabled` setting disabled so browser-history measurement cannot add
duplicate SPA events if Enhanced Measurement is enabled later. Preserve all
other Enhanced Measurement settings; provider configuration remains outside this
module.

## Development

```sh
pnpm install
pnpm --filter @narduk-enterprises/narduk-analytics run quality   # vitest
pnpm --filter @narduk-enterprises/narduk-analytics run check:package  # publint + pack --dry-run
```
