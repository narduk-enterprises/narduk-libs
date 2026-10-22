# Ponytail 5 audit — narduk-core runtime, src, scripts

What this repo does: `narduk-libs` publishes the shared Nuxt packages the fleet apps install. `@narduk-enterprises/narduk-core` is the base layer: the Nuxt module, the Worker helpers (auth, database, CSRF, rate limits, caching), and the small UI primitives those apps render. The files in this lane are what a request runs after the app is built.

Load I assumed: a published package on Cloudflare Workers, in front of the public internet. Many isolates, each with a small memory cap, and they do not share memory. D1 is the usual database. Postgres through Hyperdrive is supported. Session cookies and `nk_` API keys are real credentials. Some routes fetch a URL the caller supplied. A hot app keeps one isolate busy for a long stretch of requests.

I read the module entry, auth, sessions, CSRF, CORS, rate limits, the SSRF fetch path, the error sanitizer, database access, the cache helpers, and the three scripts. Tests were read where they pin a rule. I did not run them.

## Must fix

### 1. Two special-use IPv4 addresses are treated as public

`packages/modules/narduk-core/runtime/server/utils/ssrfHostIpPolicy.ts:15-45`

What this is: `isPrivateIPv4` decides whether an address is safe to fetch. `validateUrl` and `resolveAndAssertPublicHost` both trust it.

Problem: `isPrivateIPv4('192.0.0.9')` and `isPrivateIPv4('192.0.0.10')` return false. `192.0.0.8` and `192.0.0.11` return true. So `http://192.0.0.9/` and `http://192.0.0.10/` pass `validateUrl`, and a DNS answer of those addresses passes `resolveAndAssertPublicHost`. The same is true of the IPv4-mapped form `::ffff:192.0.0.9`, because that path calls `isPrivateIPv4`. `192.0.0.9` is the PCP anycast address. `192.0.0.10` is the TURN anycast address. Both sit in `192.0.0.0/24`, which the next line rejects. The allow is one line, with no comment and no test. `isPrivateIPv4` has no direct test. The IPv6 table never mentions these addresses. Three more special-use ranges also return false: `192.31.196.1` (AS112), `192.52.193.1` (AMT), `192.175.48.1` (AS112 direct delegation). `169.254.169.254` is rejected.

Fix: Delete the `0xc0000009` / `0xc000000a` exception so those two fall into the `192.0.0.0/24` reject. Add the three missing ranges next to the other special-use blocks. Add them to a small `isPrivateIPv4` table so a future edit fails a test.

If we skip it: an unfurl or any other caller of this checker will connect to those addresses. On a network that routes them, that is a request to protocol anycast. The rest of the private ranges stay blocked.

## Should fix

### 2. The auth rate limiter does not match the other limiter

`packages/modules/narduk-core/runtime/server/utils/rateLimit.ts:185-280`

What this is: `defineUserMutation`, `defineAdminMutation`, and `defineCronMutation` call `enforceRateLimitPolicy`. Login uses it (`authLogin`, 60 per minute). `defineRateLimitedHandler` is a second limiter in `rate-limit/window.ts`.

Problem: Two concrete splits.

- A Cloudflare binding that throws becomes a 500. `enforceCloudflareRateLimit` awaits `limiter.limit()` and does not catch. Every mutation route then fails. `defineRateLimitedHandler` catches the same throw and keeps the in-isolate verdict (`rateLimitedHandler.ts:174-177`).
- Off Cloudflare, the bucket key is the client’s own `X-Forwarded-For`. `rateLimitClientIp` calls `getClientIp(event, { trustForwardedFor: true })`. `getClientIp` uses `cf-connecting-ip` when that header is present, so a normal Worker request is fine. When the header is absent (Fly, `nuxt dev`, a Node server), the first forwarded entry is the key. `client-ip.ts` says that entry is whatever the client wrote. A caller who sends a new `X-Forwarded-For` on each login never shares a bucket, so the 60/minute cap never trips. `defineRateLimitedHandler` calls `getClientIp(event)` and does not trust that header. On Fly the client can also send `cf-connecting-ip` itself. This limiter reads that header first and does not pass `trustFlyClientIp`.

The in-isolate map here also has no size cap. The other store stops at 10,000 keys. Cleanup runs every 100 requests and only drops keys whose timestamps are already expired, so a burst of distinct keys stays for the whole window.

Fix: Make `enforceRateLimitPolicy` call `consumeRateLimit` (or the shared window store) and delete the `buckets` map. Use `getClientIp(event)` with the same defaults as the handler limiter. Catch a binding error and keep the in-isolate verdict.

If we skip it: a bad rate-limit binding takes login and every other mutation down with a 500. Any deploy that is not behind Cloudflare can walk around the auth limits by rotating one header.

### 3. CSRF and API-key auth do not agree on the Authorization header

`packages/modules/narduk-core/runtime/server/middleware/csrf.ts:91-93`

What this is: A state-changing request must send `X-Requested-With`, unless it presents an API key. `requireAuth` accepts the key through `getApiKeyFromAuthorization`.

Problem: CSRF skips only when the raw header starts with `Bearer nk_`. The parser lowercases the scheme and splits on any whitespace. `Authorization: bearer nk_<valid key>` is a real key in `requireAuth` and a 403 in this middleware. `Authorization: Bearer  nk_<valid key>` (two spaces) is the same. HTTP treats the scheme as case-insensitive. A machine client that sends `bearer` and no `X-Requested-With` cannot call any mutation.

Fix: Skip CSRF when `getApiKeyFromAuthorization(event)` returns a key. One rule, both places.

If we skip it: valid keys are rejected whenever the client does not capitalize `Bearer` exactly. Browsers usually send the capital form, so this shows up on scripts and SDKs.

### 4. A 429 from an unfurl triggers eight more fetches, one of them as Googlebot

`packages/modules/narduk-core/runtime/server/utils/urlValidator.ts:71-97` and `768-934`

What this is: `fetchWithValidatedRedirects` downloads HTML for link previews. The first request uses `OGPreviewBot/1.0`.

Problem: On HTTP 429 the function tries eight more User-Agents, in order, against the same URL. One of them is `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`. Others claim to be Facebook, LinkedIn, Twitter, Discord, WhatsApp, Telegram, and Slack. All eight run before it returns `RATE_LIMITED`. They share one 30s abort, so one preview can hold the isolate for the whole timeout and send nine requests to the target. Nothing in `tests/` calls `fetchWithValidatedRedirects` or `validateUrl`, so this loop can change and no test fails.

Fix: Delete `FALLBACK_USER_AGENTS`, `selectFallbackUserAgent`, and the 429 loop. On 429, drain the body and return `RATE_LIMITED`.

If we skip it: every rate-limited preview hammers the origin and pretends to be Googlebot. That is the request a site will block or report.

### 5. The SSE connection map has no ceiling

`packages/modules/narduk-core/runtime/server/utils/sse.ts:44-60`

What this is: `registerSSE` keeps writers in a module-level `Map`, per isolate.

Problem: `registerSSE` always inserts. There is no max. `removeSSE` runs only if the caller remembers, or if a later `broadcastSSE` hits a writer that throws or rejects. A room that accepts connections and does not broadcast keeps every writer until the isolate dies. The sample in the file waits on `event.node.req` `close`. A Worker request does not reliably emit that when the client leaves. Ten thousand connects with no `removeSSE` leave ten thousand writers in `_channels`.

Fix: Cap the map (reject or drop the oldest when it is full). Have `registerSSE` take the request `AbortSignal` and call `removeSSE` on abort, and point the sample at that.

If we skip it: one busy channel can grow the isolate until the runtime kills it. Other requests on that isolate die with it.

### 6. An oversized body is rejected without closing the stream

`packages/modules/narduk-core/runtime/server/utils/boundedBody.ts:42-45`

What this is: `readBoundedBody` is the size ceiling for an upstream response. The comment says a body over the ceiling is cancelled, not drained.

Problem: When `Content-Length` is a finite number above `maxBytes`, the function throws and returns. It never calls `response.body.cancel()`. The stream keeps the connection until something else drops it. A caller that fetches many oversized URLs (a crawler, a proxy) holds one connection per response. The later read loop does cancel. This early path does not.

Fix: `await response.body?.cancel()` before throwing in that branch.

If we skip it: oversized responses pin connections in the isolate. Under a burst, new fetches stall behind them.

### 7. Cache cleanup deletes rows the stale window still serves

`packages/modules/narduk-core/runtime/server/utils/d1Cache.ts:128-150` and `180-185`

What this is: `withD1Cache` can return an expired row for `staleWindowSeconds` and refresh in the background. `cleanExpiredCache` deletes every `kv_cache` row with `expires_at` in the past. The file comment tells you to call it from a cron.

Problem: A row with `ttlSeconds: 300` and `staleWindowSeconds: 3600` is still meant to be served for an hour after expiry. A cron that calls `cleanExpiredCache` every five minutes deletes that row on the first run after expiry. The next request is a miss and waits on the fetcher. The stale path never runs. `cache-version:*` rows are safe only because their expiry is year 9999.

Fix: On write, store the stale deadline (fresh expiry plus `staleWindowSeconds`). Delete only rows past that deadline. A row written with no stale window keeps today’s behaviour.

If we skip it: any app that follows both comments gets a synchronous fetch on every expiry. The stale window is dead code in production.

### 8. A scheduled call that cannot read config is treated as D1

`packages/modules/narduk-core/runtime/server/utils/database.ts:199-207`

What this is: `useDatabase` picks `d1`, `postgres`, or `none` from `runtimeConfig.databaseBackend`.

Problem: If `useRuntimeConfig(event)` throws and the event is a Cloudflare scheduled event, the function returns `'d1'`. A Postgres app then looks up the `DB` binding. With a leftover D1 binding, the cron reads and writes D1 while the site uses Postgres. With no `DB` binding, the cron 500s with “D1 database binding not available” even though the app is on Hyperdrive. A normal request rethrows and does not guess.

Fix: Rethrow. If scheduled handlers really have no runtime config, read `NUXT_DATABASE_BACKEND` from the worker env and fail closed when it is missing.

If we skip it: a Postgres cron that hits this path either writes the wrong database or fails with a D1 error that points at the wrong fix.

## Nice to have

### 9. The second API-key lookup in requireAuth cannot succeed

`packages/modules/narduk-core/runtime/server/utils/auth.ts:359-370`

What this is: `requireAuth` tries an API key, then the sealed session, then an API key again.

Problem: The first branch handles every request whose `Authorization` header is an `nk_` bearer, and it 401s when that key is bad. It does not fall through. The second `authenticateApiKey` runs only when `getApiKeyFromAuthorization` already returned null, and that function returns null again. The call never authenticates anyone.

Fix: Delete the second call and the comment that says the chain ends in another API-key try.

If we skip it: nothing user-visible. The next person will debug a path that cannot run.

### 10. A Postgres client is opened per request and never closed

`packages/modules/narduk-core/runtime/internal/postgres-runtime.ts:10-18`

What this is: `createPostgresDatabase` builds a `postgres.js` client with `max: 1` and `prepare: false`. `useDatabase` keeps it on the request, then drops it.

Problem: Nothing calls `client.end()`, and `idle_timeout` is left at the driver default, which keeps the socket open. On Node (`nuxt dev`, a Node server) each request that touches Postgres leaves a connection. After enough requests the database refuses new ones with too many clients. On Workers, Hyperdrive’s own docs say the platform may drop the client when the request ends, so this is the Node case.

Fix: Call `end()` from `waitUntil` at the end of the request, or set a short `idle_timeout`. One client per isolate, keyed by the connection string, also works if concurrent requests share it.

If we skip it: local and Node Postgres deploys run out of connections. Worker deploys may be fine.

## Left out

2 smaller ones, not written up as findings:

- `00-canonical-host.ts` treats any site hostname that starts with `localhost` or `127.0.0.1` as local, so `SITE_URL=https://localhost.example.com` turns canonical redirects off.
- `fetchUrlSafely` is an alias of `fetchWithValidatedRedirects`. It is a public name. Leave it.

Documented behaviour I am not flagging: in-isolate rate limits are per isolate on purpose. List cursors are unsigned on purpose. `withOptionalValidatedBody` turns a body that does not parse into the fallback on purpose. The legacy CSP still sends `'unsafe-inline'` on purpose, with the strict preset beside it. `getSessionGrantValidator` is kept because removing it breaks apps.

## Verdict

Auth, the sealed session, the error sanitizer, and the CSRF path grammar are in good shape and have tests. I would not trust the IPv4 SSRF allow-list or the mutation rate limiter until the two fixes above land. The rest are small and local.

Lean: -170 lines, -0 dependencies possible. (Delete the unfurl User-Agent fallback and the dead API-key branch.)

Not checked: Vue templates and CSS under `runtime/app` (I used the script side only). `runtime/drizzle/` and `runtime/drizzle-pg/` SQL, and `unicode-search-folds.json`. Most of `narduk-data.ts` past the checksum check, most of `units.ts`, `preferences.ts`, and `security-headers.ts`. I read `prove-nonce.mjs` and `prove-cf-ssr-d1.mjs` for what they claim and how they fail, and I did not run them. I did not boot workerd, so I did not check whether `nodejs_compat` sets `process.versions.node`. If it does, `urlValidator.ts` `isNodeRuntime()` treats a Worker as Node and either refuses every unfurl or pins with undici. Other packages, including callers of these helpers in `narduk-auth`, are other lanes.
