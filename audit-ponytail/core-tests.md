# Ponytail 5 audit: narduk-core tests

What this repo does: narduk-libs publishes the shared Nuxt packages that Narduk apps install. `@narduk-enterprises/narduk-core` is the Worker runtime those apps share: sessions, CSRF, rate limits, cache, D1 helpers, and security headers. This lane is its test suite (`packages/modules/narduk-core/tests`, 180 files).

Load I assumed: a published library on many Nuxt apps, each serving concurrent Cloudflare Worker requests. A test is doing its job when the risky check breaks and that test fails in CI. I treated per-isolate memory as real and not shared across isolates. I treated `cf-connecting-ip` as present on traffic that actually comes through Cloudflare.

6 smaller notes are left out, after the findings.

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

## Should fix

### 3. The login limiter trusts `X-Forwarded-For`, and its test never calls it — `runtime/server/utils/rateLimit.ts:186-248`

What this is: `enforceRateLimit`, used by `mutation.ts` for `authLogin` and the other auth policies. `tests/rateLimit.test.ts:29-39` only checks that two policy name strings appear in the source. The code is outside `tests/`.

Problem: `rateLimitClientIp` calls `getClientIp(event, { trustForwardedFor: true })`. With no `cf-connecting-ip`, the first `X-Forwarded-For` value is the bucket. One request with `X-Forwarded-For: 1.1.1.1` and another with `X-Forwarded-For: 2.2.2.2` get two buckets, so the 60-per-minute login cap never fills. `defineRateLimitedHandler` does not trust that header, and its store stops at 10,000 keys. This map has no cap. On Cloudflare the edge sets `cf-connecting-ip`, which is read first, so the split happens when that header is absent (Fly, or any host that is not Cloudflare).

Fix: Stop passing `trustForwardedFor: true`. Add a test where two different `X-Forwarded-For` values and no Cloudflare header share one bucket. Cap the map the same way as `RATE_LIMIT_MAX_TRACKED_KEYS`.

If we skip it: Off Cloudflare, rotating one header defeats the login limit, and the key map grows with each new header. The source-text test stays green.

### 4. Demo redirect path turns into another host — `runtime/server/utils/demo.ts:40-51`

What this is: `normalizeDemoRedirectPath`. Nothing in this repo calls it. `tests/fixtures/consumer-server-globals.d.ts` exists so typecheck knows about the `createError` this file uses without an import. The code is outside `tests/`.

Problem: `normalizeDemoRedirectPath('/\\evil.example')` returns `/\\evil.example`. Resolved against `https://app.example/`, that URL is `https://evil.example/`. `//evil.example` and `https://evil.example` correctly become `/dashboard`. No test imports the function.

Fix: Search fleet imports of `server/utils/demo`. If there are none, delete `demo.ts` (51 lines). If something calls it, reject a path whose resolved origin is not the app origin, and add the `/\\evil.example` case.

If we skip it: An app that sends this return value to the browser sends the user to the other host. CI stays green.

### 5. Hard-coded CSRF skips have no boundary test — `runtime/server/middleware/csrf.ts:71-93`

What this is: Skips for webhooks, cron, callbacks, auth, Nuxt Content, `/api/owner-tag`, and `Authorization: Bearer nk_`. The exempt-path grammar in `csrf-exempt-paths.test.ts` is tested. These skips are not. `csrf-middleware.test.ts` never posts to them and never sends `Authorization`.

Problem: The webhook check is `startsWith('/api/webhooks/')`. Drop the trailing slash and `POST /api/webhooks-evil` with no `X-Requested-With` is allowed. No test fails. `/api/owner-tag` uses exact equality. The report-route comment on lines 83-85 says `event.path` keeps the query string. `POST /api/owner-tag` is skipped. `POST /api/owner-tag?x=1` is 403. `Authorization: Bearer nk_not-a-real-key` on `POST /api/settings` skips CSRF. No test sends that header.

Fix: Match those paths with `isCsrfExemptPath`, including `/api/owner-tag`. Add one test each: `/api/webhooks/x` allowed, `/api/webhooks-evil` denied, `/api/owner-tag?x=1` allowed, `Bearer nk_` skipped, `Bearer other` denied.

If we skip it: A one-character edit widens the webhook skip, and the owner-tag route 403s as soon as the URL has a query string.

### 6. CORS middleware has no test — `runtime/server/middleware/cors.ts:21-65`

What this is: The `/api/*` CORS handler. No test imports it.

Problem: An origin is reflected only when it is in the comma-separated list, and the handler does not set `Access-Control-Allow-Credentials`. Change the check on line 49 so every `Origin` is reflected. Every current test still passes. A page on another site can then read the API responses it is allowed to send. Any `chrome-extension://` or `moz-extension://` origin is reflected when the path starts with `/api/admin/scraper-extension/`. No test locks that prefix.

Fix: One test. An origin that is not on the list gets no `Access-Control-Allow-Origin`. A listed origin gets that origin. A `chrome-extension://` origin is reflected only on the scraper prefix, and not on `/api/admin/other`.

If we skip it: A reflected-origin change ships on a green suite.

### 7. The "ignore forwarded-for" test allows a wrong address — `tests/client-ip.test.ts:32-36`

What this is: The test named "ignores x-forwarded-for by default".

Problem: The header is `9.9.9.9, 198.51.100.4`. The assertion is `not.toBe('9.9.9.9')`. If `getClientIp` returns the raw header, or only `198.51.100.4`, this test still passes. The other cases in the file expect an exact address.

Fix: Assert the exact value this request has with that header ignored (the socket address, or `undefined`).

If we skip it: A change that keys rate limits on the forwarded header, in a shape other than the first address alone, stays green.

### 8. The three CSRF header injectors are not run — `runtime/app/plugins/fetch.client.ts:18-26`

What this is: `fetch.client.ts`, `useCsrfFetch` (`runtime/app/composables/useCsrfFetch.ts:22-36`), and `useAppFetch`. `tests/useAppFetch.test.ts:30-33` only checks that the source contains an import line. No test executes the header injection. The middleware tests assume the header is present.

Problem: Delete the `headers.set('X-Requested-With', ...)` in any of the three and `useAppFetch.test.ts` still passes. Store and plugin mutations then get 403 from the middleware. `useCsrfFetch` adds the header only when `request` is a string starting with `/`, so a POST to `https://app.example/api/items` sends no header and the middleware returns 403. `fetch.client.ts` line 20 treats every URL that starts with `/` as same-origin, so `//evil.example/api` gets the header.

Fix: One test per helper. A relative POST gets the header. An absolute same-origin POST gets it. `//evil.example/api` does not. A GET does not.

If we skip it: The middleware suite stays green while clients stop sending the header, and mutations 403. Or the plugin marks a protocol-relative URL as same-origin.

## Nice to have

### 9. A source test keeps a showcase login policy that shares the real login bucket — `runtime/server/utils/rateLimit.ts:120`

What this is: `RATE_LIMIT_POLICIES.showcaseAuthLogin`. The only other mention is `tests/rateLimit.test.ts:34-38`, which requires that source line to exist.

Problem: The policy namespace is `auth-login`, the same string as `authLogin` on line 85. The in-memory key is namespace plus address, so 60 showcase calls and the next real login share one window and the 61st throws 429. Deleting the policy fails this test.

Fix: Confirm no app reads `RATE_LIMIT_POLICIES.showcaseAuthLogin`. Then delete the policy and the assertion that requires it.

If we skip it: The string test blocks removal, and any caller of the showcase policy spends the real login budget.

6 smaller ones left out: the bcrypt cost check is locked at cost 30 and not at 13; `systemPrompts.ts` and the Hyperdrive helper have no behavior test; several UI composables have no test; `requireAuth` calls `authenticateApiKey` again on a path the first branch already returned from (that dead call is in `runtime/server/utils/auth.ts`, outside this lane); a handful of other tests read source text, and I did not find a wrong result in them.

Verdict: Sessions, the CSRF path grammar, shared secrets, SQL binding, cache privacy, and job leases have tests that fail when the check breaks. The SSRF allow-list and the old login limiter do not. A green run does not cover those two.

Lean: -1335 lines, -1 dependency possible. That is `demo.ts` (51) if nothing imports it, plus `urlValidator.ts` (1227), `unfurlResponseUtils.ts` (56), and `undici` if nothing imports the fetcher, plus the showcase policy line after the same kind of check. Do not delete either file on a guess. Both are public `server/*` exports.

Not checked: I did not run vitest. I did not read all 180 test files line by line. I did not re-walk every branch of `narduk-data.ts` (its tests name origin, checksum, redirect, and credential checks), `src/module.ts`, `units.ts`, the icon and color-mode build fixtures, or the Vue shells. UI-only gaps are in the left-out count.
