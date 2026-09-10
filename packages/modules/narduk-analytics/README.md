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

## Runtime config (env vars)

All keys below are read once at build/start time via `process.env` in
`src/module.ts` unless noted otherwise. Server-side Google/PostHog admin routes
additionally support Worker-runtime-secret overrides (Cloudflare binding/secret
takes priority over the build-time value) via narduk-core's `readRuntimeString`
— see each route for its specific env var name.

### Public (client-visible) config

| Env var                                                           | `runtimeConfig.public` key                | Default                    | Purpose                                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `NUXT_PUBLIC_ANALYTICS_LOAD_STRATEGY` / `ANALYTICS_LOAD_STRATEGY` | `analyticsLoadStrategy`                   | `idle`                     | `immediate` \| `idle` \| `interaction` \| `off` — when client analytics scripts load.                                      |
| `GA_MEASUREMENT_ID`                                               | `gaMeasurementId`                         | `''`                       | GA4 measurement ID (`G-XXXXXXX`). Empty disables `gtag.client`.                                                            |
| `POSTHOG_HOST`                                                    | `posthogHost`                             | `https://us.i.posthog.com` | PostHog ingestion host.                                                                                                    |
| `POSTHOG_DEAD_CLICKS_ENABLED`                                     | `posthogDeadClicksEnabled`                | `false`                    | Enables PostHog dead-click autocapture.                                                                                    |
| `POSTHOG_EXTERNAL_DEPENDENCY_LOADING_ENABLED`                     | `posthogExternalDependencyLoadingEnabled` | `false`                    | Allows PostHog to load its own external dependencies (e.g. for surveys) when session replay is off.                        |
| `POSTHOG_FEATURE_FLAGS_ENABLED`                                   | `posthogFeatureFlagsEnabled`              | `false`                    | Enables PostHog feature flags.                                                                                             |
| `POSTHOG_SESSION_REPLAY_ENABLED`                                  | `posthogSessionReplayEnabled`             | `false`                    | Enables PostHog session replay recording when explicitly set to `true`.                                                    |
| `POSTHOG_SURVEYS_ENABLED`                                         | `posthogSurveysEnabled`                   | `false`                    | Enables PostHog surveys and their automatic display.                                                                       |
| `NUXT_PUBLIC_INDEXNOW_KEY`                                        | `indexNowKey`                             | `''`                       | Public IndexNow key, used by the client-visible config surface (see also the private key below).                           |
| — (from `narduk-core`)                                            | `posthogPublicKey`                        | `''`                       | PostHog **project API key**. Without this, `posthog.client` no-ops. Seeded by the runtime-public overlay, not this module. |
| — (from `narduk-core`)                                            | `deploymentTarget`                        | `production`               | `production` \| `staging` \| `preview`. Drives the `is_internal_user`/`environment` PostHog super-properties (see below).  |
| — (from `narduk-core`)                                            | `previewSafeMode`                         | `false`                    | When true, all client analytics plugins no-op regardless of load strategy.                                                 |

### Private (server-only) config

| Env var                                                                                                | `runtimeConfig` key       | Purpose                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OWNER_TAG_SECRET`                                                                                     | `ownerTagSecret`          | Shared secret required by `POST /api/owner-tag` to set/clear the owner cookie.                                                                                  |
| `POSTHOG_OWNER_DISTINCT_ID`                                                                            | `posthogOwnerDistinctId`  | Optional PostHog distinct ID shared across your own devices; served by `GET /api/owner/posthog-bootstrap` once the owner cookie is set.                         |
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

| Route                           | Method       | Purpose                                                                                                |
| ------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `/api/owner-tag`                | `POST`       | Set/clear the `narduk_owner` cookie used to tag owner traffic in PostHog. Requires `OWNER_TAG_SECRET`. |
| `/api/owner/posthog-bootstrap`  | `GET`        | Returns `POSTHOG_OWNER_DISTINCT_ID` for cross-device PostHog identity once the owner cookie is set.    |
| `/api/indexnow/submit`          | `POST`       | Submits URLs (default: homepage + sitemap) via the IndexNow protocol.                                  |
| `/{key}.txt` (middleware)       | `GET`/`HEAD` | Serves the configured IndexNow key at its verification path.                                           |
| `/api/admin/ga/overview`        | `GET`        | GA4 totals + daily rows for a date range (`startDate`, `endDate`, `noCache`).                          |
| `/api/admin/gsc/performance`    | `GET`        | GSC search-performance rows by dimension (`query`/`page`/`device`/`country`/`searchAppearance`).       |
| `/api/admin/gsc/sitemaps`       | `GET`        | Lists submitted sitemaps and their indexing counts.                                                    |
| `/api/admin/gsc/submit-sitemap` | `POST`       | Submits a sitemap URL to Search Console.                                                               |
| `/api/admin/gsc/inspect-url`    | `POST`       | Runs a Search Console URL Inspection.                                                                  |
| `/api/admin/indexing/batch`     | `POST`       | Google Indexing API — batch-publish up to 100 URL notifications.                                       |
| `/api/admin/indexing/publish`   | `POST`       | Google Indexing API — publish a single URL notification.                                               |
| `/api/admin/indexing/status`    | `GET`        | Google Indexing API — last notification status for a URL.                                              |
| `/api/admin/posthog/pages`      | `GET`        | Top pages by pageviews for a period.                                                                   |
| `/api/admin/posthog/referrers`  | `GET`        | Top referrers for a period.                                                                            |
| `/api/admin/posthog/devices`    | `GET`        | Device/browser breakdown for a period.                                                                 |
| `/api/admin/posthog/entry-exit` | `GET`        | Top entry/exit pages for a period.                                                                     |
| `/api/admin/posthog/insights`   | `GET`        | Arbitrary HogQL-backed insight results for a period.                                                   |
| `/api/admin/posthog/recordings` | `GET`        | Recent session recordings (up to `limit`).                                                             |

## IndexNow

`notifyIndexNow()` (`server/utils/indexNow.ts`) and `POST /api/indexnow/submit`
submit URLs to the shared [IndexNow](https://www.indexnow.org/) endpoint,
`https://api.indexnow.org/indexnow`. Search engines that participate in the
IndexNow protocol (Bing, Yandex, Seznam.cz, Naver, and others) share this index,
so a single submission to `api.indexnow.org` typically propagates to all of them
— but that propagation is between the participating engines, not a direct ping
this module makes to each one. Requires `INDEXNOW_KEY` (or
`NUXT_PUBLIC_INDEXNOW_KEY`) to be set; the same key is served back at
`/{key}.txt` for ownership verification.

## Owner and preview traffic tagging

`posthog.client` registers PostHog super-properties on every event so you can
filter yourself and non-production traffic out of dashboards (Project Settings →
"Filter out internal and test users"):

- `is_owner` — set via the `narduk_owner` cookie (`POST /api/owner-tag`).
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
