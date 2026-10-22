# Ponytail 5 audit: narduk-core tests

What this repo does: narduk-libs publishes the shared Nuxt packages that Narduk apps install. `@narduk-enterprises/narduk-core` is the Worker runtime those apps share: sessions, CSRF, rate limits, cache, D1 helpers, and security headers. This lane is its test suite (`packages/modules/narduk-core/tests`, 180 files).

Load I assumed: a published library on many Nuxt apps, each serving concurrent Cloudflare Worker requests. A test is doing its job when the risky check breaks and that test fails in CI. I treated per-isolate memory as real and not shared across isolates. I treated `cf-connecting-ip` as present on traffic that actually comes through Cloudflare.

5 smaller notes are left out, after the findings.

## Must fix

### 1. `isPrivateIPv4` allows 192.0.0.9 and 192.0.0.10 — `runtime/server/utils/ssrfHostIpPolicy.ts:27`

What this is: The IPv4 check in front of the SSRF fetcher. The line sits outside `tests/`. No test calls `isPrivateIPv4`. `tests/ssrf-host-ip-policy.test.ts` only calls `isPrivateIPv6`.

Problem: `isPrivateIPv4('192.0.0.9')` and `isPrivateIPv4('192.0.0.10')` return false. `isPrivateIPv4('192.0.0.8')` and `isPrivateIPv4('192.0.0.170')` return true. Those two addresses are inside `192.0.0.0/24`, which line 35 blocks, and they are the PCP anycast addresses in that block. I ran the shipped functions: `validateUrl('http://192.0.0.9/')` returns valid, and `resolveAndAssertPublicHost('192.0.0.9')` returns that address as a public pin. The IPv6 tests never embed `192.0.0.9`, so they stay green.

Fix: Delete line 27. Add one assertion that `192.0.0.9` and `192.0.0.10` are private, same as `192.0.0.8`.

If we skip it: The fetcher will dial `192.0.0.9` and `192.0.0.10`. A later edit can reopen another special-use block and CI stays green.

### 2. The SSRF fetcher has no test — `runtime/server/utils/urlValidator.ts:432-765`

What this is: `validateUrl` and `fetchWithValidatedRedirects`. Nothing under `tests/` imports this file. It is a public `server/utils/urlValidator` export. `undici` is imported only here.

Problem: I ran `validateUrl` with `nodeEnv: 'production'`. `http://localhost/` is rejected. `http://localhost./` is allowed. `resolveAndAssertPublicHost('localhost.')` currently throws because DNS returns `127.0.0.1`, and no test locks that. A 302 to `http://169.254.169.254/` is rechecked only because line 702 sets `redirect: 'manual'`. Change that to `'follow'` and every existing test still passes, and the fetch follows the private `Location`. `http://2130706433/`, `http://0x7f000001/`, and `http://127.1/` are blocked today only because `new URL` rewrites them to `127.0.0.1` before the private check. No test names them.

Fix: Add tests that call `validateUrl` and `fetchWithValidatedRedirects` with a fake `fetch`. Require production to reject `http://localhost./`, `http://2130706433/`, and a 302 to `http://127.0.0.1/`. Keep the file unless a fleet search shows no import of `server/utils/urlValidator`.

If we skip it: The fetcher can start following redirects, or allowing `localhost.`, and CI stays green.

### 3. Auth and cron mutation wrappers have no test — `runtime/server/utils/mutation.ts:181-253`

What this is: `defineUserMutation`, `defineAdminMutation`, and `defineCronMutation` (`:378-407`). Each is supposed to rate-limit, then require a user, an admin, or `requireCronAuth`, and only then run the handler. Nothing under `tests/` imports them. `mutation-validation.test.ts` only imports `describeValidationFailure`. The code is outside `tests/`.

Problem: Delete the `resolveUserWithScopes` call at line 201, or the `requireCronAuth` call at line 394, and call the handler anyway. Every current test still passes. A user route then runs with no session. A cron route accepts a POST with no `CRON_SECRET`. `requireAuth` and `requireCronAuth` have their own tests. Those tests do not call these wrappers.

Fix: One real h3 request per wrapper. Auth failure is 401 or 403 and the handler is not called. A non-admin session does not satisfy `defineAdminMutation`. A cron POST with no secret is 401.

If we skip it: A one-line edit ships a write route with no identity check. This package will not catch it.

## Should fix

### 4. The login limiter trusts `X-Forwarded-For`, and its test never calls it — `runtime/server/utils/rateLimit.ts:186-248`

What this is: `enforceRateLimit`, used by `mutation.ts` for `authLogin` and the other auth policies. `tests/rateLimit.test.ts:29-39` only checks that two policy name strings appear in the source. The code is outside `tests/`.

Problem: `rateLimitClientIp` calls `getClientIp(event, { trustForwardedFor: true })`. With no `cf-connecting-ip`, the first `X-Forwarded-For` value is the bucket. One request with `X-Forwarded-For: 1.1.1.1` and another with `X-Forwarded-For: 2.2.2.2` get two buckets, so the 60-per-minute login cap never fills. `defineRateLimitedHandler` does not trust that header, and its store stops at 10,000 keys. This map has no cap. On Cloudflare the edge sets `cf-connecting-ip`, which is read first, so the split happens when that header is absent (Fly, or any host that is not Cloudflare).

Fix: Stop passing `trustForwardedFor: true`. Add a test where two different `X-Forwarded-For` values and no Cloudflare header share one bucket. Cap the map the same way as `RATE_LIMIT_MAX_TRACKED_KEYS`.

If we skip it: Off Cloudflare, rotating one header defeats the login limit, and the key map grows with each new header. The source-text test stays green.

### 5. Demo redirect path turns into another host — `runtime/server/utils/demo.ts:40-51`

What this is: `normalizeDemoRedirectPath`. Nothing in this repo calls it. `tests/fixtures/consumer-server-globals.d.ts` exists so typecheck knows about the `createError` this file uses without an import. The code is outside `tests/`.

Problem: `normalizeDemoRedirectPath('/\\evil.example')` returns `/\\evil.example`. Resolved against `https://app.example/`, that URL is `https://evil.example/`. `//evil.example` and `https://evil.example` correctly become `/dashboard`. No test imports the function.

Fix: Search fleet imports of `server/utils/demo`. If there are none, delete `demo.ts` (51 lines). If something calls it, reject a path whose resolved origin is not the app origin, and add the `/\\evil.example` case.

If we skip it: An app that sends this return value to the browser sends the user to the other host. CI stays green.

### 6. Hard-coded CSRF skips have no boundary test — `runtime/server/middleware/csrf.ts:71-93`

What this is: Skips for webhooks, cron, callbacks, auth, Nuxt Content, `/api/owner-tag`, and `Authorization: Bearer nk_`. The exempt-path grammar in `csrf-exempt-paths.test.ts` is tested. These skips are not. `csrf-middleware.test.ts` never posts to them and never sends `Authorization`.

Problem: The webhook check is `startsWith('/api/webhooks/')`. Drop the trailing slash and `POST /api/webhooks-evil` with no `X-Requested-With` is allowed. No test fails. `/api/owner-tag` uses exact equality. The report-route comment on lines 83-85 says `event.path` keeps the query string. `POST /api/owner-tag` is skipped. `POST /api/owner-tag?x=1` is 403. `Authorization: Bearer nk_not-a-real-key` on `POST /api/settings` skips CSRF. No test sends that header.

Fix: Match those paths with `isCsrfExemptPath`, including `/api/owner-tag`. Add one test each: `/api/webhooks/x` allowed, `/api/webhooks-evil` denied, `/api/owner-tag?x=1` allowed, `Bearer nk_` skipped, `Bearer other` denied.

If we skip it: A one-character edit widens the webhook skip, and the owner-tag route 403s as soon as the URL has a query string.

### 7. CORS middleware has no test — `runtime/server/middleware/cors.ts:21-65`

What this is: The `/api/*` CORS handler. No test imports it.

Problem: An origin is reflected only when it is in the comma-separated list, and the handler does not set `Access-Control-Allow-Credentials`. Change the check on line 49 so every `Origin` is reflected. Every current test still passes. A page on another site can then read the API responses it is allowed to send. Any `chrome-extension://` or `moz-extension://` origin is reflected when the path starts with `/api/admin/scraper-extension/`. No test locks that prefix.

Fix: One test. An origin that is not on the list gets no `Access-Control-Allow-Origin`. A listed origin gets that origin. A `chrome-extension://` origin is reflected only on the scraper prefix, and not on `/api/admin/other`.

If we skip it: A reflected-origin change ships on a green suite.

### 8. The "ignore forwarded-for" test allows a wrong address — `tests/client-ip.test.ts:32-36`

What this is: The test named "ignores x-forwarded-for by default".

Problem: The header is `9.9.9.9, 198.51.100.4`. The assertion is `not.toBe('9.9.9.9')`. If `getClientIp` returns the raw header, or only `198.51.100.4`, this test still passes. The other cases in the file expect an exact address.

Fix: Assert the exact value this request has with that header ignored (the socket address, or `undefined`).

If we skip it: A change that keys rate limits on the forwarded header, in a shape other than the first address alone, stays green.

### 9. The three CSRF header injectors are not run — `runtime/app/plugins/fetch.client.ts:18-26`

What this is: `fetch.client.ts`, `useCsrfFetch` (`runtime/app/composables/useCsrfFetch.ts:22-36`), and `useAppFetch`. `tests/useAppFetch.test.ts:30-33` only checks that the source contains an import line. No test executes the header injection. The middleware tests assume the header is present.

Problem: Delete the `headers.set('X-Requested-With', ...)` in any of the three and `useAppFetch.test.ts` still passes. Store and plugin mutations then get 403 from the middleware. `useCsrfFetch` adds the header only when `request` is a string starting with `/`, so a POST to `https://app.example/api/items` sends no header and the middleware returns 403. `fetch.client.ts` line 20 treats every URL that starts with `/` as same-origin, so `//evil.example/api` gets the header.

Fix: One test per helper. A relative POST gets the header. An absolute same-origin POST gets it. `//evil.example/api` does not. A GET does not.

If we skip it: The middleware suite stays green while clients stop sending the header, and mutations 403. Or the plugin marks a protocol-relative URL as same-origin.

### 10. Image redirect leaves `/_og/` after the check — `runtime/server/routes/cdn-cgi/image/[...path].ts:23-37`

What this is: The local-dev stand-in for `/cdn-cgi/image/...`. It keeps a redirect only when the path starts with `/_og/`. No test imports this file. The code is outside `tests/`.

Problem: A path `w=80/_og/../../api/secret` builds `/_og/../../api/secret`, which starts with `/_og/`, so the guard allows it. `new URL` then normalizes the pathname to `/api/secret`, and the handler redirects there. The comment says the guard exists to stop an open redirect. A path outside `/_og/` is where the browser lands.

Fix: Reject unless the normalized pathname still starts with `/_og/`. Add that case.

If we skip it: A local image URL redirects the browser to any other path on the same host, including `/api/...`. CI stays green.

### 11. Sitemap rate-limit exemption matches dot-segments — `runtime/server/rate-limit/policy.ts:145-153`

What this is: `isRateLimitExemptPath`, used by `defineRateLimitedHandler` on `event.path`. Tests lock the query string and reject `/robots.txt.map`. They do not send a dot-segment.

Problem: `/sitemap/*` is a prefix. `isRateLimitExemptPath('/sitemap/../api/admin', RATE_LIMIT_DEFAULT_EXEMPT_PATHS)` is true. The same path normalized by `new URL` is `/api/admin`. `/__sitemap__/../api/login` is exempt the same way. CSRF exemptions refuse `.` and `..` for this reason. This one does not.

Fix: Return false when the path contains a `.` or `..` segment, and add those two paths as tests.

If we skip it: A request path that still contains `..` skips the limiter on the way to `/api/admin`.

### 12. `Set-Cookie` after the cache profile stays public — `runtime/server/utils/cacheProfile.ts:271-281`

What this is: `findSuppression` downgrades to `private, no-store` when `Set-Cookie` is already on the response. The only cookie test, `tests/cache-profile.test.ts:205-213`, sets the cookie and then calls `setCacheProfile`. The code is outside `tests/`.

Problem: Call `setCacheProfile(event, 'live')` first. Then set `Set-Cookie: session=abc`. Nothing in `beforeResponse` looks at `Set-Cookie`. The response keeps `Cache-Control: public` and `CDN-Cache-Control: public` plus the cookie. Preferences and errors re-check at `beforeResponse` because their flags show up later. This one does not.

Fix: Add the reverse-order case. Downgrade in `beforeResponse` the way `preferences-cache.ts` already does, and assert `CDN-Cache-Control` is absent.

If we skip it: A shared cache can store one caller’s session cookie under a public profile. The existing test stays green.

### 13. D1 cache tests never check the bound key — `tests/d1-cache-stale.test.ts:22-24`

What this is: The fake `first()` behind `withD1Cache`. Production reads `SELECT value, expires_at FROM kv_cache WHERE key = ?` in `runtime/server/utils/d1Cache.ts`.

Problem: The fake returns the fixture row for every statement whose SQL starts with `SELECT`. It never reads the bound key. Drop the `WHERE` clause and every test in that file still passes, including the stale-window cases. On real D1, `.first()` then returns whichever row it finds first. The cache key is the tenant boundary for this helper.

Fix: Assert the prepared SQL and the bound key, or run the read through the same D1 harness `worker-cache-version-d1.test.ts` already uses.

If we skip it: A refactor that drops the predicate serves another key’s JSON and this file stays green.

### 14. Default security headers are checked as substrings — `tests/security-headers-staging.test.ts:51-58`

What this is: The test for the headers apps get when the strict preset is off.

Problem: The assertion is `toContain("default-src 'self'")`. `default-src 'self' *` and `default-src 'self' https:` still contain that text. `permissions-policy` is `toContain('camera=()')`. `camera=(), microphone=*` still contains `camera=()`. `tests/security-headers.test.ts:86-91` drops every quoted script source before comparing hosts, so adding `'unsafe-inline'` or `'unsafe-eval'` does not change that list. The strict preset tests do forbid those tokens. The default middleware, which mode `off` serves, is not pinned to the full header.

Fix: Assert the full `Content-Security-Policy` and `Permissions-Policy` strings, including the quoted script sources and `microphone=()` and `geolocation=()`.

If we skip it: The policy apps serve today can grow `*` on `default-src` or `microphone`, and this file stays green.

## Nice to have

### 15. A source test keeps a showcase login policy that shares the real login bucket — `runtime/server/utils/rateLimit.ts:120`

What this is: `RATE_LIMIT_POLICIES.showcaseAuthLogin`. The only other mention is `tests/rateLimit.test.ts:34-38`, which requires that source line to exist.

Problem: The policy namespace is `auth-login`, the same string as `authLogin` on line 85. The in-memory key is namespace plus address, so 60 showcase calls and the next real login share one window and the 61st throws 429. Deleting the policy fails this test.

Fix: Confirm no app reads `RATE_LIMIT_POLICIES.showcaseAuthLogin`. Then delete the policy and the assertion that requires it.

If we skip it: The string test blocks removal, and any caller of the showcase policy spends the real login budget.

5 smaller ones left out: `database.ts` `.get()` already returns the first row, and no test would catch a change that returns every row; a rate-limit binding test is a single request, so an always-success binding that replaces the window verdict stays green; `use-shared-now.test.ts` defines its own `useSharedNow`, so a wrong `useState` key in the real composable stays green; `runtime/server/api/runtime/public.get.ts` sets `private, no-store` and no test imports that route; `useMarkdown` allows any `data:image/` URL in an `img` tag, which does not run script.

Verdict: Sessions, the CSRF path grammar, shared secrets, SQL binding, cache privacy, and job leases have tests that fail when the check breaks. The SSRF allow-list, the mutation wrappers, and the old login limiter do not. A green run does not cover those.

Lean: -1335 lines, -1 dependency possible. That is `demo.ts` (51) if nothing imports it, plus `urlValidator.ts` (1227), `unfurlResponseUtils.ts` (56), and `undici` if nothing imports the fetcher, plus the showcase policy line after the same kind of check. Do not delete either file on a guess. Both are public `server/*` exports.

Not checked: I did not run vitest. I did not read all 180 test files line by line. I did not re-walk every branch of `narduk-data.ts` (its tests name origin, checksum, redirect, and credential checks), `src/module.ts`, `units.ts`, the icon and color-mode build fixtures, or the Vue shells. UI-only gaps are in the left-out count.
