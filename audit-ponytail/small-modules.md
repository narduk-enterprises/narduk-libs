# Ponytail audit — small modules

What this repo does: These eight packages are published libraries for Narduk Nuxt apps on Cloudflare Workers. They log each request, store vessel telemetry in Timescale, route WebSocket upgrades onto hibernating Durable Objects, call xAI, and store and serve uploaded images in R2. Shared contracts describe env keys and list queries. status-runtime stamps a build revision. libs-explorer is the design catalog.

Load I assumed: every request writes one log record and a small buffer flushes it. A queue consumer writes hundreds to a few thousand telemetry points at a time, and a Worker reads rollups. Sockets stay open and idle. AI calls are server-side and occasional, not a public firehose. Uploads are authenticated, at most 10 MB per file and 100 MB per request, then served publicly by key. List queries and the env catalog run on admin and deploy paths. The explorer is low traffic. I treated a bug in a published export as a bug even when this repo has only one caller.

## Must fix

### 1. Cached series keep the first unit forever (`packages/modules/narduk-timeseries/src/timescale/index.ts:256-262`)

What this is: `resolveSeries` remembers a vessel path after the first database upsert and skips the statement on every later batch.

Problem: The upsert sets `unit = COALESCE(EXCLUDED.unit, series.unit)`, so a later non-null unit is supposed to replace a null or old one. The cache returns before that statement. First batch: `{ path: 'navigation.speed', unit: null }`. The row is stored with a null unit and cached. Second batch: the same path with `unit: 'm/s'`. No `INSERT INTO series` runs. The row stays null. The same thing happens when the unit changes from `m/s` to `kn`. The steady-state test only repeats an identical batch, so it never sees this. On a long-lived queue process the path set stays in the 5000-entry cache, so the first unit wins for the life of the process.

Fix: On a cache hit, if the incoming unit is a non-null string and it differs from `cached.unit`, treat that descriptor as missing and run the upsert. Leave the zero-statement path in place when the unit is omitted or unchanged.

If we skip it: A corrected unit never lands. Charts and exports keep the first unit, including a null.

### 2. xAI's error text is sent to the client (`packages/modules/narduk-ai/server/utils/chatCompletions.ts:130-137`)

What this is: A non-2xx chat response becomes an H3 error. The message is `parseXaiError(body)` when the body is JSON, and a fixed sentence otherwise. `grokChat` does the same in `packages/modules/narduk-ai/server/utils/xai.ts:70-75`.

Problem: The comment says the raw body stays off the error because a provider error can echo the prompt or the account. The echo lives in `error.message`, and that field is copied through. Body `{"error":{"message":"prompt was: my secret prompt; account acct_123"}}` with status 400 becomes the client-visible message `prompt was: my secret prompt; account acct_123`. The test that locks "rate limited" uses a short benign message. The test that locks the leak uses a non-JSON body, so this case passes CI.

Fix: Throw the fixed fallback sentence. Keep the status code. The call log already records status and reason and does not record the provider text.

If we skip it: A rejected prompt or an account id in the provider message is returned to the browser.

## Should fix

### 3. Redaction misses compound names (`packages/modules/narduk-logging/src/sanitize.ts:145-158`)

What this is: `isSensitiveKey` redacts an exact key such as `email` or `prompt`, and it redacts a segment such as `token` inside `accessToken`.

Problem: `email`, `phone`, `address`, `latitude`, `longitude`, `prompt`, `completion`, `body`, and `payload` are only in the exact-key set. They are not segments. `sanitizeFields({ userEmail: 'a@b.com', systemPrompt: 'do not log this', homeAddress: '1 Main' })` returns those three values unchanged. `email` and `prompt` alone are redacted. `promptTokens` stays visible because `SAFE_NORMALIZED_KEYS` is checked first, so adding `prompt` as a segment does not hide token counts.

Fix: Add those words to `SENSITIVE_SEGMENTS`. Add a fixture for `userEmail` and `systemPrompt`.

If we skip it: A log line that uses the compound name ships the email, the address, or the prompt to the sink.

### 4. In-flight resolve keys split on a character a path may contain (`packages/modules/narduk-timeseries/src/timescale/index.ts:270-273`)

What this is: Concurrent `resolveSeries` calls share one statement when their sorted cache keys join with `|`.

Problem: `seriesCacheKey` is length-prefixed because a SignalK path may contain any separator. The in-flight map joins those keys with `|` anyway. These two missing sets produce the same key: one descriptor whose path is `navigation.speed|36:22222222-2222-2222-2222-222222222222:navigation.heading` on vessel `11111111-1111-1111-1111-111111111111`, and two descriptors (`navigation.speed` on that vessel, `navigation.heading` on `22222222-2222-2222-2222-222222222222`). Whichever call starts first, the other awaits its result, does not find its own paths, and throws `SERIES_UNRESOLVED`. A retry works after the first call finishes. The write fails only while they overlap.

Fix: Use `JSON.stringify` of the sorted keys as the map key.

If we skip it: A path that contains `|` plus another cache key makes an overlapping resolve fail closed and drop the batch.

### 5. Close handshake echoes a reason the runtime rejects (`packages/modules/narduk-realtime/src/server/durable-object.ts:115-118`)

What this is: `webSocketClose` echoes the peer close, and it substitutes code 1000 for 1005 and 1006 so `WebSocket.close` does not throw.

Problem: Since compatibility date 2026-03-03, `WebSocket.close` throws `SyntaxError` when the reason is longer than 123 UTF-8 bytes. A peer close of code 1001 with a 200-byte reason still calls `ws.close(1001, reason)`. A reserved code 1006 with that same reason calls `ws.close(1000, reason)`. Both throw. On compatibility dates on or after 2026-04-07 the runtime ignores `close()` inside this handler, so the throw is dormant there. Dates from 2026-03-03 up to 2026-04-07 still throw, and the socket stays half-closed until the runtime times it out. The unit double accepts any reason, so the test stays green.

Fix: Pass a reason trimmed to 123 UTF-8 bytes. Ignore a throw from `close()`.

If we skip it: One long close reason becomes a Durable Object exception, and session counts stay high until the runtime drops the socket.

### 6. An image prefix without a slash matches the next key (`packages/modules/narduk-uploads/runtime/server/routes/images/[...slug].get.js:77`)

What this is: `GET /images/**` serves an R2 key when the key starts with a configured prefix. The module rejects an empty prefix because that would serve the whole bucket (`packages/modules/narduk-uploads/src/module.ts:89-94`).

Problem: The check is `slug.startsWith(entry.prefix)`. Prefix `v1` matches `v1/ok.png` and also `v1-private/secret.png` and `v10/a.png`. The default prefix is `uploads/`, which is safe. A configured prefix that omits the slash is not. The README examples all include the slash. The setup check does not require it.

Fix: Reject a prefix that does not end with `/` at setup, next to the empty-prefix check.

If we skip it: One missing slash publishes every key that shares that character prefix.

### 7. A failed multi-file upload leaves the earlier objects (`packages/modules/narduk-uploads/runtime/server/api/upload.post.js:133-151`)

What this is: Each accepted file is written to R2 in order. The response lists only the keys that finished.

Problem: Two valid images. The first `put` succeeds. The second throws. The handler logs `storedCount: 1` and rethrows. Nothing deletes the first key. The client gets a 500 and no URL. The object remains under `uploads/`, which the public image route serves. The key is a UUID, so a stranger does not guess it. Repeated failures leave the objects behind.

Fix: On a failed `put`, `deleteFromR2` every key already in `results`, then rethrow.

If we skip it: The bucket accumulates objects nobody can name from the response, and each one is still publicly readable if the key leaks later.

### 8. `grokChat` waits forever on a silent provider (`packages/modules/narduk-ai/server/utils/xai.ts:131-154`)

What this is: `grokListModels` aborts after 10 seconds. The comment there says a stalled xAI must not hold the admin request. `grokChat` and `grokChatStream` call `fetch` with no `signal`.

Problem: xAI accepts the TCP connection and sends no bytes. `grokChat` stays on `response.json()` until the Worker or the caller gives up. `chatCompletion` already bounds each attempt at 30 seconds. These two helpers do not.

Fix: Pass `AbortSignal.timeout` into `createXaiRequest`, using the same 30 second bound as `chatCompletion` for `grokChat`. For the stream, bound the wait for headers the same way.

If we skip it: One stalled provider call holds the Worker invocation until the platform kills it.

### 9. The SSE parser keeps one line without a limit (`packages/modules/narduk-ai/server/utils/xai.ts:182-221`)

What this is: `createXaiSseStreamParser` splits the provider stream on newlines and parses `data:` lines.

Problem: A chunk with no `\n` is appended to `buffer` and kept. A 50 MB body with no newline stays in that string until the stream ends. The Worker runs out of memory and the invocation dies. A normal xAI stream sends newlines. A truncated or hostile body does not.

Fix: If `buffer.length` passes 1 MiB, error the stream and drop the buffer.

If we skip it: One bad stream kills the isolate for that request and can take the Worker over its memory limit.

### 10. A non-finite `retries` never stops (`packages/modules/narduk-ai/server/utils/chatCompletions.ts:230-252`)

What this is: `chatCompletion` retries a 5xx, a network error, or a timeout `retries` times. The default is 1.

Problem: `Math.max(0, NaN)` is `NaN`, and `NaN ?? 1` does not replace `NaN`. `tries >= NaN` is false forever. `chatCompletion(messages, { retries: NaN, apiKey, model })` against a 502 fetches until the Worker is killed. `retries: Infinity` does the same. `timeoutMs: NaN` is a different miss: `setTimeout` treats it as a short delay, so every attempt aborts at once and the call returns 504.

Fix: If `retries` is not a finite integer of 0 or more, use 1. If `timeoutMs` is not a finite number above 0, use 30 seconds.

If we skip it: A bad config either hammers the provider or fails every call as a timeout.

### 11. Saving a missing system prompt reports success (`packages/modules/narduk-ai/server/api/admin/system-prompts/index.put.ts:22-36`)

What this is: `PUT` updates `system_prompts` where `name` matches, then returns `{ success: true }`.

Problem: Body `{ name: 'does-not-exist', content: 'hello' }` updates zero rows. The handler still returns success. The admin UI shows the prompt as saved. The next read still has the old content, or no row.

Fix: Read the affected row count. Return 404 when it is 0.

If we skip it: An admin edits a typo'd name, sees success, and the model keeps the previous prompt.

### 12. The chosen chat model expires after a year (`packages/modules/narduk-ai/server/utils/chatModelConfig.ts:12-21`)

What this is: `setStoredChatModel` writes the admin's model id to KV with `ADMIN_CHAT_MODEL_TTL_SECONDS` (365 days). `kvSet` passes that number as `expirationTtl`.

Problem: On day 366 the key is gone. `getStoredChatModel` returns `grok-3-mini`. Chats switch model with no write and no log. KV keeps a key forever when `put` is called without a TTL.

Fix: Call `kvSet` without a TTL.

If we skip it: A year after the last save, production silently changes model.

### 13. A comment defeats the Influx safety check (`packages/modules/narduk-timeseries/src/influx.ts:105-131`)

What this is: `assertHostSafeFlux` refuses a query with no `aggregateWindow`, and it refuses `group()` before `aggregateWindow`. That check exists because an unreduced read OOM-killed the replica on 2026-09-09.

Problem: The search is `indexOf` on the raw string. This flux passes:

```
// aggregateWindow used to be here
from(bucket: "t") |> range(start: :start:, stop: :end:) |> group() |> keep(columns: ["_value"])
```

The word `aggregateWindow` sits in the comment, ahead of `group(`. `assertHostSafeFlux` returns the string. `readWindowed` sends it. The replica sees the same unreduced shape as the outage.

Fix: Strip `//` lines and `/* */` blocks before the two searches.

If we skip it: The next edit of a parity query can take the replica down again. The file is marked temporary until G4 parity; the check is still the guard while it runs.

### 14. List `offset` has no ceiling (`packages/contracts/narduk-platform/src/list-query.ts:254-257`)

What this is: `listQuerySchema` clamps `limit` to the route's max. In offset mode, `offset` is any integer of 0 or more.

Problem: `?offset=1000000&limit=25` parses. The route then runs `OFFSET 1000000`. On a large table that walks a million rows to return 25. `limit=1e12` is rejected by the clamp. `offset` is not. Every offset-mode list route in the estate inherits this.

Fix: Reject `offset` above a ceiling (10_000 is enough for admin lists) unless the route passes a higher `maxOffset`.

If we skip it: One query string turns a list route into a long scan.

### 15. A Doppler `from` with an extra slash keeps the wrong key (`packages/contracts/narduk-platform/src/env-catalog.ts:865-871`)

What this is: `parseCatalogFrom` splits `doppler:<project>/<config>/<key>`. The nvault arm rejects extra segments. The Doppler arm keeps the first three and drops the rest.

Problem: `parseCatalogFrom('doppler:narduk/prd/MAPKIT/SERVER_API_KEY')` returns key `MAPKIT`, not `MAPKIT/SERVER_API_KEY`. Provisioning then reads a different secret, or a missing one, and can write that value into the app. The live catalog has no `doppler:` entries (the platform test asserts that). The function is still exported.

Fix: Reject a fourth segment the same way the nvault arm does.

If we skip it: The day a four-part Doppler path is parsed, the wrong value is the one that gets deployed.

### 16. Prompt providers stampede on a cold cache (`packages/modules/narduk-ai/server/utils/aiPromptResolver.ts:240-254`)

What this is: `resolveSelectionChunk` reads the context cache, and on a miss it calls `provider.provide` and then `cache.set`.

Problem: Fifty requests arrive in the same moment for one cache key. Each one sees a miss. Each one calls `provide`. There is no single-flight map. A provider that reads D1 or Postgres does that work fifty times, then fifty writes race into the cache.

Fix: Share one in-flight `provide` per cache key, the same way `resolveSeries` shares one statement.

If we skip it: The first burst after a TTL expiry multiplies the provider's database load by the number of concurrent AI requests.

## Nice to have

### 17. `start()` with no WebSocket never tries again (`packages/modules/narduk-realtime/src/client/live-socket.ts:142-148`)

What this is: `createLiveSocket` connects from `start()`. `start()` returns immediately unless the state is `stopped`.

Problem: Call `start()` where `globalThis.WebSocket` is missing (a server render, or a test that has not installed a fake yet). `connect` sets the state to `closed` and returns. A later `start()` sees `closed` and does nothing. The socket stays down after `WebSocket` exists.

Fix: If there is no implementation, leave the state `stopped`.

If we skip it: One early `start()` sticks the client in `closed` until the page makes a new object.

### 18. `readR2AsBase64` copies the object one byte at a time (`packages/modules/narduk-uploads/runtime/server/utils/r2.js:45-51`)

What this is: The helper reads an R2 object into a binary string, then `btoa`. The upload route does not call it. It is a public server auto-import. This repo has no other caller. Other repos may. Do not delete it without checking them.

Problem: An 8 MB object runs one `binary += String.fromCharCode(...)` per byte, then base64-encodes the whole string. There is no size cap. The upload path allows 10 MB. That is a long CPU burst and a second full copy on a Worker.

Fix: Encode fixed-size slices and join those, and refuse objects over `MAX_FILE_SIZE`.

If we skip it: Any app that still calls this helper on a full-size image spends the request on the copy.

I left out 5 smaller ones: the `/favicon` skip matches any path that starts with that string, an empty manual prompt placeholder inserts the context between every character, client diagnostics will log a caller-supplied `fatal`, `Cache-Control: max-age` without `public` is not treated as a shared cache, and `normalizeExtension` still rewrites `svg+xml` which the allow-list never stores.

Verdict: Fix the series-unit cache and the xAI error text before the next release of those two packages. Those two change stored data or hand a prompt to the client. The other findings need a bad input, a stall, or a later failure. Upload auth and the WebSocket authoriser fail closed in this slice. status-runtime and the explorer message checks did not show a defect at this load.

Not checked: `defineUserMutation` and `defineAdminMutation` in narduk-core (auth and CSRF live there). narduk-postgres parameter chunking. A live Timescale database, a live xAI call, and a live R2 bucket. The committed `narduk-realtime` `dist/` against a fresh build. Every `libs-explorer` `app/usage/*.vue` body and the Playwright specs. Go and Python logging trees beyond their READMEs. I read `provider-console.ts` as type declarations only.
