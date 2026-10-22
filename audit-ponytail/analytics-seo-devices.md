# Ponytail audit: analytics, seo, devices

What this repo does: These three packages are published Nuxt modules for Narduk apps on Cloudflare. `narduk-analytics` loads PostHog and GA4, tags owner traffic, and reads GA, Search Console, and PostHog for admins. `narduk-seo` builds sitemap, robots, JSON-LD, and Open Graph cards. `narduk-devices` stores device claims, credentials, and signed sessions in D1.

Load I assumed: Each package is imported by many Worker apps, not run as one big service. Analytics is one event per page view, plus a few admin queries. SEO work is mostly at build time, with crawlers hitting robots, sitemap, and `/_og/`. Devices is many devices per org, claim starts and session opens that overlap, and D1 as a single writer. A Worker isolate does not share memory with the next request.

I read the READMEs, the three module entry points, and the claim, session, lockout, privacy, IndexNow, Google, sitemap, and OG paths end to end. I checked HogQL host, traffic, and time-zone fragments: host text is escaped, traffic is an allowlist, and `tz` must be a zone `Intl` accepts. 7 smaller items are left out, listed at the end.

## Must fix

### 1. A session opened during revoke stays valid — `packages/modules/narduk-devices/server/utils/devices.ts:2435-2520`

What this is. `openSession` checks the device, verifies the signature, inserts a replay row, then inserts the session. `getSessionByTokenWithDevice` treats any unexpired row with `revokedAt` null as live.

Problem. Revoke or rotate can commit during `await verifySignature`. Revoke marks the device revoked and revokes sessions that already exist (`devices-revocation.ts:104-108`). Rotate does the same for that credential class (`devices-revocation.ts:196-217`). The in-flight `openSession` then inserts a new `devices_sessions` row with `revokedAt: null` (`devices.ts:2456-2470`). For the default 30-minute TTL, `requireDeviceSession` accepts that bearer (`guards.ts:72-74`). The comment at `devices.ts:2514-2519` says a live session means the device was not revoked under it. This insert does not keep that promise. The same split burns the replay row before the session insert. If the session insert throws, the same signed request comes back as `replayed request` and can never be presented again.

Fix. Put the replay insert and the session insert in one batch. Insert the session only while the device is still `claimed` and that credential's `revoked_at` is null. If that matches nothing, roll the replay row back and return `revoked` or `unauthorized`.

If we skip it. A revoke that lands while a signature check is in flight leaves a working bearer for up to 30 minutes. A crash after the replay insert makes the device's own retry look like a replay.

### 2. Strict mode sends a relative URL unchanged — `packages/modules/narduk-analytics/app/utils/analyticsPrivacy.ts:52-66`

What this is. Strict mode's last `before_send` hook runs `templateUrl` on every `$…url` and `$…referrer` property.

Problem. `templateUrl('/farms/frm_1/2024?token=invite-secret#frag', 'https://acre.example', resolveRoute)` hits `new URL(value)`, throws, and returns that string. The record id, the query, and the fragment are sent. The same input through standard mode's `sanitizeStandardUrl` (`analyticsPrivacy.ts:102-116`) returns `/farms/frm_1/2024` with the token removed. The built-in pageview builds an absolute URL first (`posthog.client.ts:118`), so that one path is templated. `usePosthog().capture('$pageleave', { $current_url: '/farms/frm_1?token=invite-secret' })` is not. The README says strict mode reduces every `$…url`. The tests cover absolute URLs and `$direct`. They never pass a path.

Fix. When `new URL(value)` throws and the value starts with `/`, `?`, or `#`, run it through `templatePath` and drop the query. Leave `$direct` and `''` unchanged.

If we skip it. A relative `$current_url` or `$referrer` in strict mode leaves the browser with the raw path and query. Standard mode would have stripped the secret.

## Should fix

### 3. The first completion spends the device proof before the device exists — `packages/modules/narduk-devices/server/utils/devices.ts:2156-2169`

What this is. On `completeClaimWithRecordedApproval`, `proves()` verifies the signature and then `consumeScopedNonce` (`devices.ts:1224-1235`). `completeClaimAtomically` runs only after that returns true.

Problem. The nonce insert commits on its own. If the completion batch then throws, the session is still `pending_user_approval` and the proof is spent. The device retries the same signed body. `proves()` returns false, `authorize` returns `unauthorized_user` (`devices.ts:2208-2210`), and `fail()` counts a failure on the claim token. Five retries is a 15-minute lockout, which is the whole claim-token life, so the pending session expires while the token is locked. The comment at `2157-2162` burns the nonce early so a captured proof cannot later re-issue credentials. That property still holds if the burn commits in the same batch as the device row: a rollback leaves the nonce free, and a commit still spends it.

Fix. Insert the completion nonce in the completion batch, gated on the device insert. Do not call `consumeScopedNonce` before that batch.

If we skip it. One D1 error, or a double submit of the same proof, turns the device's retry into `unauthorized_user` and can lock the claim token until the ceremony has expired.

### 4. A stale reissue can revoke a newer credential — `packages/modules/narduk-devices/server/utils/devices-complete-claim.ts:259-324`

What this is. `reissueCredentialsAtomically` reads `revocationGeneration`, then takes a lock whose nonce is that old number, then sets the generation to `observed + 1`.

Problem. The lock insert's `WHERE` is "this device, and the proof is unspent" (`devices-complete-claim.ts:270-271`). It does not require the generation to still be the one that was read. `rotateCredential` can commit after that read. It revokes the old secret, inserts the operator's new secret, and increments the generation. The reissue lock nonce is `String(oldGeneration)`, which rotate never writes, so the insert still lands. The batch then revokes every unrevoked credential, including the secret rotate just returned (`devices-complete-claim.ts:327-337`), and assigns `revocationGeneration` to the stale `nextGeneration` (`321-324`). If two rotations moved generation from `G` to `G+2`, that assign sets it back to `G+1`.

Fix. Add `revocation_generation = <observed>` to the lock insert's `WHERE`. If that select is empty, change nothing.

If we skip it. An operator rotation during the claim-session window can return a secret that a stale reissue immediately revokes, and the stored generation can go backwards.

### 5. Two overlapping rotations: the first secret is already dead — `packages/modules/narduk-devices/server/utils/devices.ts:2599-2634`

What this is. `rotateCredential` reads the current version, adds one, and returns that new secret. The batch revokes every live credential of that class, then inserts the prepared row (`devices-revocation.ts:208-237`).

Problem. There is no unique key on `(device_id, credential_class, version)`. Two overlapping `rotateCredential({ deviceId, credentialClass: 'command' })` calls both read version 1. The first batch inserts secret A at version 2 and returns A. The second batch's revoke matches A (`revoked_at IS NULL`), inserts secret B, and returns B. `getCredentialBySecret(A)` is null. The first caller was given a shown-once secret that does not authenticate.

Fix. In that batch, insert only while the live version is still `prepared.version - 1`. If the insert matches nothing, throw `conflict` and do not return the unused secret.

If we skip it. A double-submitted rotate shows the operator a bearer the other call has already revoked.

### 6. A lost idempotency race is reported as `revoked` — `packages/modules/narduk-devices/server/utils/devices.ts:1069-1089`

What this is. Idempotency keys are unique across every claim session (`devices-schema.ts:100-103`). `startClaimAtomically` uses `onConflictDoNothing()` with no target (`devices-start-claim.ts:84`), so an idempotency collision and a token collision both return zero rows.

Problem. Sequentially, a second `startClaim` with the same idempotency key and a different token throws `conflict` (`devices.ts:1887-1894`). Concurrently, both calls miss the pre-read. One insert wins. The loser conflicts on `idempotency_key`, `startClaimAtomically` returns false, and `resolveLostRedemption` finds no session for the loser's token. The token is unconsumed and unexpired, and the function still returns `status: 'revoked'` (`1085-1089`). `fail()` then counts a failure against that token. Five such races lock a token that can still be redeemed with a new idempotency key.

Fix. When the insert returns no row, this token has no session, and the token is not revoked or expired, throw `conflict`. Keep `revoked` for a token that is revoked or consumed.

If we skip it. A client that treats `revoked` as terminal abandons a usable claim token, and the failure counts toward its lockout.

### 7. An in-flight approval can stamp a claim that already completed — `packages/modules/narduk-devices/server/utils/devices.ts:2015-2044`

What this is. `issueApprovalToken` refuses a session whose status is already `claimed`. The update that stores the approval digest is `WHERE id = ?` only.

Problem. Call A reads `pending_user_approval`. `completeClaim` commits and sets `claimed` during `await sha256Hex`. Call A's update still overwrites `approval_token_hash` on the claimed row (`2033-2044`). A later `completeClaim` with `reissueOnIdempotentReplay: true` and A's new raw token passes `canReissue` (`2091-2095`) and rotates the device's live credentials. The same call after completion, with no overlap, throws `conflict`.

Fix. Add `status = 'pending_user_approval'` to that update's `WHERE`. If it changes no row, re-read and throw `conflict`, `revoked`, or `expired`.

If we skip it. With reissue on, an approval that was in flight at completion time rotates the device after the ceremony finished.

### 8. Expired challenges are never removed — `packages/modules/narduk-devices/server/utils/devices.ts:1015-1035`

What this is. Every `issueChallenge` inserts a row for a 5-minute window (`2344-2357`). `prune` deletes expired replay entries, expired scoped nonces, and old auth attempts.

Problem. Nothing deletes `devices_challenges`. `openSession` still rejects an expired challenge (`2416-2418`), so old rows do not open sessions. A device that opens a session every 30 minutes leaves one row forever. There is also no cap. A caller that knows a `deviceId` can insert without bound on the challenge step. Sessions store `challenge_id` as text with no foreign key.

Fix. Delete challenges with `expires_at <= now` in the same prune batch.

If we skip it. Challenge rows grow with every session open for the life of the database, and a tight `issueChallenge` loop on a known device id is an unbounded D1 write.

### 9. Untagging the owner leaves the Secure flag cookie — `packages/modules/narduk-analytics/server/utils/owner-tag-proof.ts:161-165`

What this is. `POST /api/owner-tag` with `enabled: false` calls `clearOwnerTagCookies`.

Problem. Production sets `narduk_owner` with `secure: true` (`46-53`). Clear calls `deleteCookie(event, 'narduk_owner', { path: '/' })` and does not pass `secure`. Chrome will not overwrite a Secure cookie with a `Set-Cookie` that lacks `Secure`, so `narduk_owner=true` stays. `posthog.client` still sets `is_owner`, and the unsigned flag still yields `traffic_class=owner`. The `__Host-` proof cookie is deleted with `secure: true` (`148-152`), so bootstrap stops while the owner tag remains. `tests/owner-tag-bootstrap.test.ts` checks that proof cookies use the `__Host-` name when Secure is on. It does not require `Secure` on the cleared flag.

Fix. Pass `secure: true` and `sameSite: 'lax'` when deleting the flag on HTTPS, the same way the proof cookie is cleared.

If we skip it. "Remove the tag" leaves that browser classified as owner until the cookie expires, up to a year.

### 10. Google API failures are answered as 500 — `packages/modules/narduk-analytics/server/admin/api/admin/gsc/inspect-url.post.ts:62-76`

What this is. Handlers around `googleApiFetch`. That function throws `GoogleApiError`, which has `.status` and no `.statusCode` (`server/utils/google.ts:28-37`).

Problem. URL inspect checks `err.statusCode === 403`. That is never true. A Google 403 becomes HTTP 500, and the "access denied" message is dead. The same cast is in `gsc/sitemaps.get.ts:61-66`, `indexing/publish.post.ts:65-71`, and `indexing/status.get.ts:46-54`. A 429 from the Indexing API also becomes 500. `ga/overview.get.ts` and `gsc/performance.get.ts` already branch on `error instanceof GoogleApiError` and use `error.status`.

Fix. Use that same branch in these four handlers.

If we skip it. A missing Search Console grant, a quota error, and a bad URL all look like a 500.

### 11. No-referrer traffic is a referrer named `$direct` — `packages/modules/narduk-analytics/server/admin/api/admin/posthog/referrers.get.ts:66-72`

What this is. `GET /api/admin/posthog/referrers`, which the PostHog panel still reads.

Problem. PostHog stores a missing referrer as `$referring_domain = '$direct'`. This route only treats `''` as unknown, so the row is `{ referrer: '$direct' }` with no `unknown` flag. `normalizeReferrerDomain('$direct')` in `analyticsOrigins.ts:88-101` returns `''`, and the origins route labels that "No referrer". The admin route test uses `''`, not `$direct`.

Fix. Map the value with `normalizeReferrerDomain` before choosing the label and the `unknown` flag.

If we skip it. The behavior panel's top referrer for direct traffic is the string `$direct`.

### 12. IndexNow submit builds the wrong key URL and reports failures as submitted — `packages/modules/narduk-analytics/server/api/indexnow/submit.post.ts:21-122`

What this is. `POST /api/indexnow/submit` is a public, rate-limited route. The key file is served only at `/<key>.txt` (`indexNowKeyVerification.ts:81`). `notifyIndexNow` slices to 10,000 and returns `submitted: 0` when the ping fails (`indexNow.ts:151-175`).

Problem. `SITE_URL=https://example.com/docs` produces `keyLocation` `https://example.com/docs/<key>.txt` (`submit.post.ts:75`). IndexNow fetches that path, misses the middleware, and returns 403. `notifyIndexNow` sends `https://${host}/<key>.txt`, which matches the file this package serves. Separately, the body schema is `z.array(z.string().url())` with no max (`21-23`). One request with 10,001 on-host URLs is posted whole. IndexNow rejects batches over 10,000. The handler still returns `{ submitted: 10001, results: [{ ok: false, status: 400 }] }` (`118-122`). A single rejected URL returns `submitted: 1` with `ok: false`.

Fix. Build `keyLocation` as `https://${host}/${key}.txt`. Cap the array at 10,000. Set `submitted` from the count IndexNow accepted.

If we skip it. An app whose site URL has a path cannot verify, so every submission 403s. Callers that trust `submitted` treat a rejected batch as sent, and one request can push a Worker-sized body at IndexNow.

### 13. An unset catalog URL is baked as `https://catalog.nard.uk` — `packages/modules/narduk-seo/src/module.ts:560-564`

What this is. `PUBLIC_CATALOG_BASE_URL` is optional. When it is missing, setup stores `https://catalog.nard.uk` on `runtimeConfig.public.publicCatalogBaseUrl`. The footer links whenever that string is non-empty (`LayerNetworkFooter.vue:26-29` and `68-76`).

Problem. An app that sets neither `PUBLIC_CATALOG_BASE_URL` nor `NUXT_PUBLIC_PUBLIC_CATALOG_BASE_URL` still renders "Part of the Narduk Enterprises network" as a link to `https://catalog.nard.uk`. The README says the footer omits the hub link when the value is unset. `resolveNardukCatalogBaseUrl` returns null for an empty string and says this package must not pin every app to one hostname (`nardukNetworkDirectory.ts:67-74`). `tests/network-directory.test.ts` forbids that hostname in the runtime files. `module.ts` is outside that scan.

Fix. Bake `''` when the env var is missing. The footer `v-if` already hides an empty URL.

If we skip it. Every consumer that did not choose a catalog host links to `catalog.nard.uk`.

### 14. A non-HTTPS directory URL is still indexed — `packages/modules/narduk-seo/src/module.ts:689-707`

What this is. Build time treats any non-empty `networkDirectoryUrl` as configured (`566-569`). Request time only fetches absolute `https://` URLs (`resolveNardukNetworkDirectoryUrl`).

Problem. `nardukSeo.networkDirectoryUrl: 'http://catalog.example/sites.json'` is truthy. The sitemap `urls` list includes `/narduk-network`, and the `noindex, follow` rule is not added. The page's `directoryConfigured` check is the raw string (`narduk-network.vue:21-33`), so it does not emit `noindex`. The handler resolves the URL to null, skips the fetch, and the page renders empty. Crawlers get an empty page in the sitemap. `'not a url'` does the same. The README says anything other than an absolute HTTPS URL is "not configured".

Fix. Use `resolveNardukNetworkDirectoryUrl` at build time. Only a non-null result adds the sitemap URL and skips the noindex rule.

If we skip it. Invalid config publishes an empty indexable URL. A valid `https://` URL is unchanged.

### 15. Host noindex trusts `X-Forwarded-Host` — `packages/modules/narduk-seo/server/middleware/hostAwareIndexing.ts:19-26`

What this is. With `hostAwareIndexing` on, this middleware sets `X-Robots-Tag: noindex, nofollow` when the request host is not the canonical site host. It calls `getRequestHost(event, { xForwardedHost: true })`.

Problem. Production, flag on, `siteUrl` `https://example.com`. Request to `https://app.workers.dev/sitemap.xml` with `X-Forwarded-Host: example.com`. `isNonCanonicalIndexingHost('example.com', 'https://example.com')` is false, so the middleware sets no header. The same request without that header is `noindex, nofollow`. Sitemap, robots.txt, and other non-page routes do not run the page plugin. `narduk-core` passes `xForwardedHost: false` for the same kind of host check (`runtime-public.ts:130`). That package is outside this lane. The bug to fix is this middleware.

Fix. Call `getRequestHost(event)` with `xForwardedHost` left off.

If we skip it. A client-supplied header marks a `workers.dev` alias of the production worker as canonical for every non-page response.

### 16. Page `<lastmod>` follows the build machine's time zone — `packages/modules/narduk-seo/src/sitemapLastmod.ts:35-38`

What this is. `toIsoDate` uses `Date.parse`, then `toISOString()`. A `YYYY-MM-DD` date is UTC. A datetime with no `Z` or offset is local time.

Problem. Page source `useSeo({ modifiedAt: '2026-01-15T00:30:00' })`. `TZ=UTC` bakes `2026-01-15T00:30:00.000Z`. `TZ=Pacific/Auckland` (UTC+13 in January) bakes `2026-01-14T11:30:00.000Z`. The same file's `article:modified_time` stays the literal `2026-01-15T00:30:00`. Git `%cI` values already carry an offset, so they are stable. `tests/sitemap-lastmod.test.ts` covers a date, a `Z` datetime, and an offset datetime. It does not cover a datetime with no zone.

Fix. If the literal has a time and no zone, append `Z` before `Date.parse`. Leave date-only strings on the UTC date parse.

If we skip it. A non-UTC `nuxt generate` publishes a different `<lastmod>` than a UTC Workers build, and the calendar day can move.

### 17. The OG preview image check accepts a path that leaves the origin — `packages/modules/narduk-seo/server/api/og-image/resolve.get.ts:25-27`

What this is. `isSafePreviewImagePath` is "empty, or `/` not followed by another `/`". The card renders that string as `<img :src="image">` (`OgImageDefault.takumi.vue:224`).

Problem. Query `image=/\evil.example/a.png` passes the check whose message says "same-origin absolute paths". In this runtime, `new URL('/\\evil.example/a.png', 'https://app.example')` is `https://evil.example/a.png`. `sanitizeSameOriginPath('/\\evil.example/a.png', '')` returns the fallback (`same-origin-path.ts:30`, and `tests/same-origin-path.test.ts` rejects it). The preview resolver does not use that helper. In dev the resolver is open. Outside dev it needs the preview flag and an admin session. The signed `/_og/` request then loads that `src` while painting the card.

Fix. Reject the image unless `sanitizeSameOriginPath(value, '') === value`.

If we skip it. A preview request can make the worker fetch an off-origin URL while painting the card.

### 18. The OG route preview can send the admin cookie off-origin — `packages/modules/narduk-seo/server/utils/adminOgImageRoutePreview.ts:29-35`

What this is. The helper fetches `` `${origin}${target.routePath}` `` and copies `getRequestHeaders(event)` onto that request, including `cookie`.

Problem. `origin` `https://app.example` and `routePath` `@evil.example/x` request `https://app.example@evil.example/x`, which is host `evil.example` with the caller's cookies. The in-repo handler only passes `routePath: '/'` (`og-image-previews.get.ts`). The helper is the export an app uses to register its own preview routes, and it does not require a path `sanitizeSameOriginPath` would accept. `tests/fetch-timeouts.test.ts` only uses `'/'`.

Fix. Resolve `routePath` with `sanitizeSameOriginPath` and abort when it falls back. Send `accept` and `cookie` only, and only to that same-origin URL.

If we skip it. Any caller that passes a path not starting with `/` sends the admin cookie off-origin.

### 19. `catalogUrl` replaces the software URL and does not set `isPartOf` — `packages/modules/narduk-seo/app/composables/useSoftwareApplicationSchema.ts:57-92`

What this is. `canonicalUrl = catalogUrl ?? url`, then that value is the JSON-LD `url`. `isPartOf` is emitted only from `isPartOfUrl`.

Problem. `useSoftwareApplicationSchema({ name: 'Harbor', url: 'https://harbor.example', catalogUrl: 'https://catalog.example' })` emits `{"@type":"SoftwareApplication","name":"Harbor","url":"https://catalog.example"}` and no `isPartOf`. The README says to pass the catalog origin so `isPartOf` points at the hub. `url` is dropped whenever `catalogUrl` is set. No test calls this composable.

Fix. Keep `url` as the node `url`. Pass `catalogUrl` through as `isPartOf` when `isPartOfUrl` is absent.

If we skip it. JSON-LD that follows the README declares the catalog as the software's own URL.

## Nice to have

### 20. Seven exported OG color constants are unused here — `packages/modules/narduk-seo/app/utils/ogImageDefinition.ts:7-13`

What this is. `SEO_OG_IMAGE_TEXT_PRIMARY`, `SEO_OG_IMAGE_TEXT_SOFT`, `SEO_OG_IMAGE_TEXT_MUTED`, `SEO_OG_IMAGE_TEXT_DIM`, `SEO_OG_IMAGE_BADGE_INK`, `SEO_OG_IMAGE_SURFACE_INK`, and `SEO_OG_IMAGE_SURFACE_DEEP` are exported. A search of this repo finds only those lines. `SEO_OG_IMAGE_PRESET_SKY`, `SEO_OG_IMAGE_PRESET_GREEN`, and the two default colors are used. Leave those.

Problem. The seven names are still reachable via the `./app/utils/*` export. Nothing in this repo reads them.

Fix. Search published consumers for these seven names. If none import them, delete the seven lines. That delete is a breaking remove of a public export, so confirm first.

If we skip it. Seven hex constants stay in the public utils module.

## Verdict

Fix the session race and the strict URL leak before the next release of those two packages. Revoke does not cover a session inserted while the signature check is in flight, and strict mode can send a path and query that standard mode would have stripped. The other findings are real and narrower: claim races, a cookie that will not clear, IndexNow and Google error reporting, and SEO defaults that publish the wrong URL.

Lean: -7 lines, -0 dependencies possible.

7 smaller ones left out: a fingerprint or org id trimmed on start and compared raw on complete; `listDevices` stops at 200 with no cursor; a parallel burst passes the lockout check before any failure is recorded; two isolates in one colo can both pass the enrollment cache check; a quoted Indexing API batch boundary returns `success: true` with `results: []`; `notifyIndexNow` does not repeat the submit route's host check (IndexNow is likely to reject the mismatch, so that wrong result is not proven); a `git log` that exceeds 64MB or 120s is reported as `not-a-repository` and the build logs nothing.

Not checked: admin chart Vue files past the data they bind, Playwright specs, changelogs, `posthog-js` and `nuxt-og-image` internals, and every test body. Other packages are out of scope. The `xForwardedHost: false` call in `narduk-core` is evidence for finding 15, not a finding to fix in this lane.
