# @narduk-enterprises/narduk-analytics

PostHog, Google Analytics 4 (GA4), Google Search Console (GSC), and IndexNow
Nuxt **module** for Narduk Cloudflare apps. It ships client-side analytics
loading, an owner-traffic tagging flow, admin dashboards for GA/GSC/PostHog,
Google Indexing API helpers, and IndexNow key verification/submission.

## Peer: `@nuxt/ui` at `4.11.1`

The admin components this package ships (the GA, GSC and PostHog dashboards)
render Nuxt UI, so `@nuxt/ui` is a peer at exactly `4.11.1`, the version
narduk-core and narduk-shell pin (narduk-libs#1033). An app on narduk-core
already installs it.

## Requires `@narduk-enterprises/narduk-core`

This module has a hard runtime dependency on
[`@narduk-enterprises/narduk-core`](../narduk-core): the client plugins
(`posthog.client`, `gtag.client`, `analytics-head.client`) declare
`dependsOn: ['runtime-public']` and read `posthogPublicKey`, `gaMeasurementId`,
`deploymentTarget`, and `previewSafeMode` from the **runtime-public overlay**
that `narduk-core` applies on every request (Nitro `00-runtime-public` plugin so
`__NUXT__` is filled from Worker bindings, plus `/api/runtime/public` and the
`00-runtime-public.client` fetch). See narduk-core README § "Public runtime
overlay (Workers Builds)". Do not read `wrangler.json` from `nuxt.config.ts` to
paper over empty baked keys.

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
    adminPage: true, // register /admin/analytics when admin routes are on (default: true)
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

| Surface                                          | Standard                                                                | Strict                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostHog `$pageview` URL                          | raw path (`/farms/frm_1/2024`)                                          | route pattern (`/farms/:farmId/:year`)                                                                                                                                                                                                                    |
| Every other PostHog URL                          | paths and permitted queries; sensitive query keys and fragments removed | a final `before_send` hook reduces every `$…url`, `$…referrer` and `$…pathname` property — including `$set`, `$set_once` and nested web-vitals payloads — to the route pattern; another site's URL is cut to its origin; `title` and element text dropped |
| Autocapture, rage/dead clicks                    | PostHog defaults (autocapture on)                                       | off, plus `mask_all_text` / `mask_all_element_attributes`                                                                                                                                                                                                 |
| Heatmaps                                         | PostHog project setting decides                                         | off                                                                                                                                                                                                                                                       |
| Session replay, surveys                          | `POSTHOG_*_ENABLED` flags                                               | off, whatever the flags say                                                                                                                                                                                                                               |
| `/flags` request, remote extensions              | on                                                                      | off (`advanced_disable_flags`, `disable_external_dependency_loading`)                                                                                                                                                                                     |
| Web-vitals attribution                           | `POSTHOG_WEB_VITALS_ATTRIBUTION_ENABLED`                                | off (it carries element selectors and resource URLs); plain web vitals still allowed                                                                                                                                                                      |
| `$exception` message                             | raw `error.message` in `$exception_list`                                | none: every `$exception_list[].value` is `(redacted)`, and `$exception_message` and `redacted_message` are dropped; type, stack and route pattern stay                                                                                                    |
| GA4 `page_path` / `page_location` / `page_title` | raw path, `document.title`                                              | route pattern for all three, also set with `gtag('set')` so tag-collected events inherit it; `page_referrer` cut to origin; Google signals and ad personalisation off                                                                                     |
| PostHog persistence                              | SDK default                                                             | Host-only cookie; campaign persistence disabled. Raw landing URL can still persist on that host.                                                                                                                                                          |

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

Build-time `process.env` reads in `src/module.ts` are **seeds only**. Workers
Builds does not export `wrangler.json` `vars` into `nuxt build`, so those seeds
are often empty in CI even when the Worker already has the keys (buoys#133).
narduk-core's request-time overlay fills `gaMeasurementId`, `posthogPublicKey`,
and `posthogHost` from the Worker env (short names or `NUXT_PUBLIC_*` aliases)
before SSR. Server-side Google/PostHog admin routes also prefer a live Worker
binding via narduk-core's `readRuntimeString`.

### Public (client-visible) config

| Env var                                                           | `runtimeConfig.public` key                | Default                    | Purpose                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ----------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NUXT_PUBLIC_ANALYTICS_LOAD_STRATEGY` / `ANALYTICS_LOAD_STRATEGY` | `analyticsLoadStrategy`                   | `idle`                     | `immediate` \| `idle` \| `interaction` \| `off` — when client analytics scripts load.                                                                                                                                                                              |
| `GA_MEASUREMENT_ID` / `NUXT_PUBLIC_GA_MEASUREMENT_ID`             | `gaMeasurementId`                         | `''`                       | GA4 measurement ID (`G-XXXXXXX`). Empty disables `gtag.client`. The build value is a seed; narduk-core's overlay reads the Worker variable per request, before SSR.                                                                                                |
| `POSTHOG_HOST` / `NUXT_PUBLIC_POSTHOG_HOST`                       | `posthogHost`                             | `https://us.i.posthog.com` | PostHog ingestion host.                                                                                                                                                                                                                                            |
| `POSTHOG_DEAD_CLICKS_ENABLED`                                     | `posthogDeadClicksEnabled`                | `false`                    | Enables PostHog dead-click autocapture.                                                                                                                                                                                                                            |
| `POSTHOG_EXTERNAL_DEPENDENCY_LOADING_ENABLED`                     | `posthogExternalDependencyLoadingEnabled` | `false`                    | Allows PostHog to load its own external dependencies (e.g. for surveys) when session replay is off.                                                                                                                                                                |
| `POSTHOG_FEATURE_FLAGS_ENABLED`                                   | `posthogFeatureFlagsEnabled`              | `false`                    | Enables PostHog feature flags.                                                                                                                                                                                                                                     |
| `POSTHOG_SESSION_REPLAY_ENABLED`                                  | `posthogSessionReplayEnabled`             | `false`                    | Enables PostHog session replay recording when explicitly set to `true`.                                                                                                                                                                                            |
| `POSTHOG_SURVEYS_ENABLED`                                         | `posthogSurveysEnabled`                   | `false`                    | Enables PostHog surveys and their automatic display.                                                                                                                                                                                                               |
| `POSTHOG_WEB_VITALS_ENABLED`                                      | `posthogWebVitalsEnabled`                 | `false`                    | Enables Core Web Vitals reporting (`$web_vitals`). See below.                                                                                                                                                                                                      |
| `POSTHOG_WEB_VITALS_ATTRIBUTION_ENABLED`                          | `posthogWebVitalsAttributionEnabled`      | `false`                    | Adds web-vitals attribution debug data. Ignored unless web vitals are enabled.                                                                                                                                                                                     |
| `NUXT_PUBLIC_INDEXNOW_KEY`                                        | `indexNowKey`                             | `''`                       | Public IndexNow key, used by the client-visible config surface (see also the private key below).                                                                                                                                                                   |
| `POSTHOG_PUBLIC_KEY` / `NUXT_PUBLIC_POSTHOG_PUBLIC_KEY`           | `posthogPublicKey`                        | `''`                       | PostHog **project API key** (`phc_…`). Without it, `posthog.client` no-ops. This module seeds the key from the build env; narduk-core's runtime-public overlay reads the bare Worker variable or secret on every request, before SSR, and falls back to that seed. |
| `NARDUK_DEPLOY_TARGET` (read by `narduk-core`)                    | `deploymentTarget`                        | `production`               | `production` \| `staging` \| `preview`. Drives the `is_internal_user`/`environment` PostHog super-properties (see below). A `*.workers.dev` / `*.pages.dev` request host is always `preview`.                                                                      |
| `NARDUK_PREVIEW_SAFE_MODE` (read by `narduk-core`)                | `previewSafeMode`                         | `false`                    | True whenever the resolved target is not `production`, or when set. All client analytics plugins no-op, and the overlay blanks `posthogPublicKey` and `gaMeasurementId`.                                                                                           |

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
| `/api/owner/enroll`             | `GET`        | Owner-browser enrollment hop from the operator portal (`?t=<token>`); no token answers `{ "enrollment": 1 }` as a capability probe.         |
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
| `/api/admin/posthog/overview`   | `GET`        | Pageviews, sessions and people for a window, bucketed, with the previous window and the traffic split (admin Analytics page).               |
| `/api/admin/posthog/health`     | `GET`        | Last event, daily volume against baseline and the share of events that carry a `traffic_class`.                                             |
| `/api/admin/posthog/origins`    | `GET`        | Sessions by channel, referrer, campaign, landing page or country (`dimension`).                                                             |
| `/api/admin/posthog/pages`      | `GET`        | Top pages by pageviews for a period.                                                                                                        |
| `/api/admin/posthog/referrers`  | `GET`        | Top referrers for a period.                                                                                                                 |
| `/api/admin/posthog/devices`    | `GET`        | Device/browser breakdown for a period.                                                                                                      |
| `/api/admin/posthog/entry-exit` | `GET`        | Top entry/exit pages for a period.                                                                                                          |
| `/api/admin/posthog/insights`   | `GET`        | Arbitrary HogQL-backed insight results for a period.                                                                                        |
| `/api/admin/posthog/recordings` | `GET`        | Recent session recordings (up to `limit`).                                                                                                  |

## Admin Analytics page

With admin routes on, the module adds `/admin/analytics` (set
`nardukAnalytics.adminPage: false` to opt out and mount `AdminAnalyticsPage`
yourself). It shows one app's own data from PostHog, GA4 and Search Console.
There is no fleet view.

Query contract shared by the `posthog/*` reads: `period` (`1h`, `3h`, `12h`,
`24h`, `7d`, `28d`, `30d`) or `start`/`end` (a custom range, end excluded), `tz`
(an IANA zone; day buckets follow it) and `traffic` (`external` by default,
`all`, or a comma list of traffic classes). The traffic filter reads
`properties.traffic_class`; a missing value counts as external (unmarked).

Honest states, by design:

- A source that cannot answer says "Not measured", never zero. Google (GA4 and
  Search Console) is daily only, so it is disabled on sub-day ranges, and Search
  Console lags two to three days, so those days are left out, not zero.
- A blank referrer is "No referrer (unknown)", not direct.
- People are distinct for the whole range and are never summed across days.
- Stale data is stamped with its age; a failed refresh keeps the last good
  figures under a stale banner.
- Deploy markers are not drawn: there is no release source in this module.

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

## Traffic classification

Every event carries `traffic_class` and `classification_version` (1), so readers
can tell Logan's browsers and our automation from real visitors. Nothing is
dropped: events are tagged, and readers filter. Events sent before this version
carry no `traffic_class`; readers treat that as `unmarked`.

| `traffic_class` | `traffic_evidence`      | When                                                                                                                                                                                                            |
| --------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automation`    | `ua_marker`             | The user agent contains `NardukAutomation/<tool>`; `automation_tool=<tool>` is added.                                                                                                                           |
| `owner`         | `signed_enrollment`     | The browser holds a verified `__Host-narduk_traffic` class claim for this origin.                                                                                                                               |
| `owner`         | `authenticated_session` | A signed-in narduk-auth **admin** session on an app that sets `nardukAnalytics.authenticatedOwner: true` (its admins are the estate owner). Other signed-in users stay unmarked. Never set it on a client site. |
| `owner`         | `unsigned_claim`        | Only the legacy, client-settable `narduk_owner=true` cookie. Lower evidence (inferred).                                                                                                                         |
| `unmarked`      | `none`                  | Everybody else.                                                                                                                                                                                                 |

Precedence is the table order. Hosts ending in `.test` count as preview
(`is_internal_user`), never production. PostHog gets them as super properties
registered before the first capture (the class is resolved before
`posthog.init`, and `before_send` stamps it last). GA4 gets the same values
through `gtag('set')` before the config command, so every event carries them as
event parameters. **GA4 reports on them only after each (`traffic_class`,
`traffic_evidence`, `automation_tool`, `classification_version`) is registered
as an event-scoped custom dimension** in each property (Admin → Custom
definitions); until then they are collected but not queryable in GA4 reports.

**Automation** appends the marker to its user agent and changes nothing else
(Lighthouse keeps its device emulation). `narduk-app-tools` live probes send
`NardukAutomation/narduk-app-tools`.

**Owner enrollment.** Signing into the operator portal starts a top-level
redirect chain through each production estate origin's `/api/owner/enroll`. Each
hop carries an ES256 token the portal signed: about two minutes, single use,
bound to that origin, wrapping a 30-day class claim and the portal return URL.
The endpoint verifies it with the public keys in
`server/utils/traffic/trafficClaim.ts` and sets the first-party claim cookie
(`Secure`, `SameSite=Lax`, client-readable so the plugin verifies it in the
browser without a request). The claim holds only `cls: owner`, the origin and
the lifetime: no identity. No app needs a secret; the private key exists only in
the operator portal. Sign-out runs a clearing chain; expiry needs nothing;
revocation is a key-version bump (drop the `kid` from
`TRAFFIC_CLAIM_PUBLIC_KEYS` and release). Private browsing or blocked cookies
simply stay unmarked. Single use is exact per isolate and per Cloudflare colo
(Cache API) and best effort across colos; a replay can only win the `owner`
label for the replaying browser.

The issuer half lives beside the verifier in
`server/utils/traffic/trafficIssuer.ts` (`importTrafficSigner`,
`mintEnrollmentToken`, `probeTrafficEnrollment`), so the format is defined in
one place. Only the operator portal imports it, and only it holds the key; a
golden test pins tokens the portal minted before the move. The window's zone
arithmetic (`server/utils/analyticsZone.ts`) and the referrer grouping
(`server/utils/analyticsOrigins.ts`) are likewise the portal's source.

Server-side captures can classify the same way with
`resolveServerTrafficProperties(event)` (auto-imported in Nitro).

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

| Property           | Value                                                                   |
| ------------------ | ----------------------------------------------------------------------- |
| `route`            | Matched route **pattern**, never a raw path                             |
| `source`           | `client` or `server`                                                    |
| `status_code`      | HTTP status the error carried, or 500                                   |
| `fatal`            | Whether the error took down the app                                     |
| `redacted_message` | Message with query strings and emails removed (not sent in strict mode) |
| `build_version`    | Deployed commit SHA, when known                                         |
| `request_id`       | Correlation id, the same one `x-request-id` carries                     |

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

## Typed event suite

The suite is additive. Existing `usePosthog()` calls keep working, including
when initialization is deferred: calls made while loading are queued in memory
(up to 100 commands for 30 seconds), with their original route, timestamp and
properties. Disabled analytics never queues. Opt-out, initialization failure,
expiry and overflow discard pending data; an overflow fails the transport rather
than replaying part of an identity history. Expiry that discards an identity
barrier also fails the transport. When the identity bridge is enabled, the kit
clears persisted person state before replay; events recorded before the session
resolves can remain anonymous. Native SDK events are suppressed until that
initial reset and after transport failure. `useAnalytics().status` distinguishes
`pending`, `ready`, `disabled` and `failed`; `dropped` reports local discarded
commands. Acceptance into this queue does **not** prove provider intake. Blocked
trackers and a tab closed before SDK initialization can still lose events.

Enable the recommended profile explicitly in an existing app:

```ts
nardukAnalytics: {
  appId: 'your-registry-app-id',
  privacy: 'strict', // private records; public sites can use 'standard'
  events: true, // registers v-track for declared click interactions
  engagement: true,
  webVitals: true, // existing native PostHog pipeline
  identity: true, // optional nuxt-auth-utils session bridge
},
```

New generated apps with the analytics capability get this profile. They use
strict privacy for authenticated exposure and enable identity only with auth.
Existing apps keep engagement and identity off until adoption.

Every event gets `app_id`, the existing display-name `app`, `surface: 'web'`,
`route` (matched pattern), `analytics_schema_version: 1`, `environment`,
explicit boolean `is_owner` / `is_internal_user`, and known `app_version` /
`build_version`. Set `appId` to the registry ID; without it the hostname is the
compatibility fallback. Keep the existing `app` label stable because current
portal rollups join it exactly. PostHog still owns sessions, device/browser
properties, referrer and campaign attribution. The URL privacy rules above
remain in force.

```ts
const analytics = useAnalytics()
analytics.capture('search_completed', {
  search_id: 'station_search',
  query_length_bucket: searchQueryLengthBucket(query.length),
  result_count: results.length,
})
analytics.capture('form_submitted', { form_id: 'signup' })
// Capture success only after the operation actually succeeded.
analytics.capture('form_succeeded', { form_id: 'signup' })
```

Unknown event names and wrong property shapes fail typecheck. Runtime schema
validation returns `false` for invalid properties and captures nothing. Shared
schemas reject extra keys. IDs are declared catalog/UI identifiers, never record
IDs or arbitrary user input. No shared event takes query text, form contents,
page text, email addresses or full destination URLs.

| Event                                    | Properties                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `search_completed`                       | `search_id`, `query_length_bucket` (`empty`, `1-3`, `4-10`, `11-30`, `31+`), `result_count` |
| `filter_changed`, `sort_changed`         | `filter_id` / `sort_id`, declared `value`                                                   |
| `form_submitted`, `form_succeeded`       | `form_id`                                                                                   |
| `form_failed`                            | `form_id`, declared `error_category`                                                        |
| `share_clicked`                          | `action_id`, `channel` (`native`, `copy`, `email`, `sms`, `social`, `other`)                |
| `clipboard_copied`                       | `action_id` (after successful copy)                                                         |
| `file_downloaded`                        | `action_id`, `file_type` (after confirmed completion)                                       |
| `outbound_link_clicked`                  | `action_id`, `destination_host` (hostname only)                                             |
| `empty_state_shown`, `error_state_shown` | `state_id`, declared `reason`                                                               |
| `auth_session_started`                   | none                                                                                        |
| `auth_session_ended`                     | `reason` (`session_ended`, `account_changed`)                                               |
| `auth_signed_in`, `auth_signed_up`       | `method`                                                                                    |
| `auth_signed_out`                        | `reason` (`session_ended`, `account_changed`)                                               |
| `page_engagement`                        | `active_ms` delta, `page_visit_id`                                                          |
| `scroll_depth_reached`                   | `depth` (25, 50, 75, 100), `page_visit_id`                                                  |

Engagement uses monotonic time, stops at 30 seconds without activity, excludes
hidden-tab time and flushes deltas on navigation, visibility changes and
`pagehide`. There is no periodic network heartbeat. Each scroll milestone is
emitted once per visit and only for scrollable pages. Repeated flushes do not
double-count active time. Browser termination can lose the last delta; it is not
an exact billing timer. Visitors who never interact can contribute at most 30
seconds for an uninterrupted visible visit.

The optional identity bridge observes ready sessions, namespaces an opaque user
ID with `appId`, and resets identity on account changes and session end
(including logout, expiry and revocation). Restoring an existing session
identifies it but does not invent a login event. It reports subsequent sign-in
edges as `auth_session_started` and `auth_session_ended`; call method-specific
`auth_signed_in` and `auth_signed_up` at the completed auth operation when a
known method or sign-up distinction matters. Never identify with an email, name
or credential. The accepted ID format is ASCII letters, digits, `_` and `-`.
Strict mode uses a host-only PostHog cookie; it can still persist a raw landing
URL **on that host** before `before_send`. Outgoing payload filtering and cookie
isolation are different guarantees.

For a declarative click (never an operation success):

```vue
<NuxtLink
  v-track="{
    event: 'outbound_link_clicked',
    properties: { action_id: 'source_link', destination_host: 'example.com' },
  }"
  to="https://example.com"
>
  Source
</NuxtLink>
```

## App-owned catalogs and consumer proof

```ts
import { z } from 'zod'
import { defineAnalyticsEvents } from '@narduk-enterprises/narduk-analytics/app/utils/analyticsEvents'

const productEvents = defineAnalyticsEvents({
  primary_action_completed: z
    .object({ source: z.enum(['map', 'list']) })
    .strict(),
})
const analytics = useAnalytics(productEvents)
analytics.capture('primary_action_completed', { source: 'map' })
```

Under an enforced no-eval CSP, build the catalog with a factory instead. Zod 4
probes `new Function('')` when it builds its first object schema, and the
browser reports that caught probe as a `script-src` violation
(narduk-libs#1310). The factory runs inside `withJitlessSchemas`, which sets
Zod's `jitless` flag only while the schemas are built and then restores your
setting; validation results do not change. The shared events are built the same
way. The app and this package must resolve one `zod` instance, the normal
deduplicated install.

```ts
const productEvents = defineAnalyticsEvents(() => ({
  primary_action_completed: z
    .object({ source: z.enum(['map', 'list']) })
    .strict(),
}))
```

App events cannot redefine shared names or PostHog `$` events. Use strict
schemas and enums/declared IDs; strict mode cannot recognize arbitrary private
strings inside app-defined properties. Product vocabulary, activation
definitions and funnels stay in the app repo. The generator creates
`app/analytics/events.ts`, `useProductAnalytics()` and `docs/analytics.md` for
this purpose.

`assertAnalyticsJourney` from `@narduk-enterprises/narduk-testkit/analytics`
asserts ordered event names, a subset of primitive properties and optional exact
counts. Feed it SDK spy output or decoded browser requests. The package's
`test:e2e` runs the real installed PostHog SDK in Chromium against a synthetic
collector, checking ordering, payload privacy, opt-out and host-only cookies.
This is local delivery proof, not live PostHog intake proof.

Customer dashboards should select production traffic with `is_owner = false` and
`is_internal_user = false`. Keep an owner view for time spent across apps. Use
route patterns to aggregate pages, compare outcomes by `build_version`, and
measure return usage through successful product actions rather than pageviews.
Dashboard provisioning remains outside this module (narduk-libs#390).
