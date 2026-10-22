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

### 3. An allowed 10 MB upload builds one JavaScript number per body byte (`packages/modules/narduk-uploads/runtime/server/api/upload.post.js:56-60`)

What this is: `readBoundedFormData` calls `readMultipartFormData` from h3 1.15.11, which this package depends on. That parser walks the body and `push`es every file byte into a plain array, then `Buffer.from`s that array. On the Cloudflare preset, nitropack 2.13.4 `fetchHandler` already did `Buffer.from(await request.arrayBuffer())` before the route runs.

Problem: A `POST /api/upload` with one 10 MB image is inside `MAX_FILE_SIZE`. The same per-byte loop on 1 MB of bytes raised heap use by about 37 MB, and on 2 MB by about 63 MB. At that rate a 10 MB part is on the order of 300 MB of heap, above a Worker's 128 MB limit. The route then copies the file into another `ArrayBuffer` (`upload.post.js:137-139`). The `Content-Length` check cannot prevent this: Nitro has already buffered the body, and the blow-up is the parser, not the raw buffer. A missing `Content-Length` is also read in full before the route can return 411.

Fix: Parse the already-buffered bytes with slices of that `Buffer`, or use the web `formData()` parser. Do not call h3 1.15.11 `readMultipartFormData` for this body.

If we skip it: A file the route says it accepts can kill the isolate instead of storing the object.

## Should fix

### 4. Redaction misses compound names (`packages/modules/narduk-logging/src/sanitize.ts:145-158`)

What this is: `isSensitiveKey` redacts an exact key such as `email` or `prompt`, and it redacts a segment such as `token` inside `accessToken`.

Problem: `email`, `phone`, `address`, `latitude`, `longitude`, `prompt`, `completion`, `body`, and `payload` are only in the exact-key set. They are not segments. `sanitizeFields({ userEmail: 'a@b.com', systemPrompt: 'do not log this', homeAddress: '1 Main' })` returns those three values unchanged. `email` and `prompt` alone are redacted. `promptTokens` stays visible because `SAFE_NORMALIZED_KEYS` is checked first, so adding `prompt` as a segment does not hide token counts.

Fix: Add those words to `SENSITIVE_SEGMENTS`. Add a fixture for `userEmail` and `systemPrompt`.

If we skip it: A log line that uses the compound name ships the email, the address, or the prompt to the sink.

### 5. In-flight resolve keys split on a character a path may contain (`packages/modules/narduk-timeseries/src/timescale/index.ts:270-273`)

What this is: Concurrent `resolveSeries` calls share one statement when their sorted cache keys join with `|`.

Problem: `seriesCacheKey` is length-prefixed because a SignalK path may contain any separator. The in-flight map joins those keys with `|` anyway. These two missing sets produce the same key: one descriptor whose path is `navigation.speed|36:22222222-2222-2222-2222-222222222222:navigation.heading` on vessel `11111111-1111-1111-1111-111111111111`, and two descriptors (`navigation.speed` on that vessel, `navigation.heading` on `22222222-2222-2222-2222-222222222222`). Whichever call starts first, the other awaits its result, does not find its own paths, and throws `SERIES_UNRESOLVED`. A retry works after the first call finishes. The write fails only while they overlap.

Fix: Use `JSON.stringify` of the sorted keys as the map key.

If we skip it: A path that contains `|` plus another cache key makes an overlapping resolve fail closed and drop the batch.

### 6. Close handshake echoes a reason the runtime rejects (`packages/modules/narduk-realtime/src/server/durable-object.ts:115-118`)

What this is: `webSocketClose` echoes the peer close, and it substitutes code 1000 for 1005 and 1006 so `WebSocket.close` does not throw.

Problem: Since compatibility date 2026-03-03, `WebSocket.close` throws `SyntaxError` when the reason is longer than 123 UTF-8 bytes. A peer close of code 1001 with a 200-byte reason still calls `ws.close(1001, reason)`. A reserved code 1006 with that same reason calls `ws.close(1000, reason)`. Both throw. On compatibility dates on or after 2026-04-07 the runtime ignores `close()` inside this handler, so the throw is dormant there. Dates from 2026-03-03 up to 2026-04-07 still throw, and the socket stays half-closed until the runtime times it out. The unit double accepts any reason, so the test stays green.

Fix: Pass a reason trimmed to 123 UTF-8 bytes. Ignore a throw from `close()`.

If we skip it: One long close reason becomes a Durable Object exception, and session counts stay high until the runtime drops the socket.

### 7. An image prefix without a slash matches the next key (`packages/modules/narduk-uploads/runtime/server/routes/images/[...slug].get.js:77`)

What this is: `GET /images/**` serves an R2 key when the key starts with a configured prefix. The module rejects an empty prefix because that would serve the whole bucket (`packages/modules/narduk-uploads/src/module.ts:89-94`).

Problem: The check is `slug.startsWith(entry.prefix)`. Prefix `v1` matches `v1/ok.png` and also `v1-private/secret.png` and `v10/a.png`. The default prefix is `uploads/`, which is safe. A configured prefix that omits the slash is not. The README examples all include the slash. The setup check does not require it.

Fix: Reject a prefix that does not end with `/` at setup, next to the empty-prefix check.

If we skip it: One missing slash publishes every key that shares that character prefix.

### 8. A failed multi-file upload leaves the earlier objects (`packages/modules/narduk-uploads/runtime/server/api/upload.post.js:133-151`)

What this is: Each accepted file is written to R2 in order. The response lists only the keys that finished.

Problem: Two valid images. The first `put` succeeds. The second throws. The handler logs `storedCount: 1` and rethrows. Nothing deletes the first key. The client gets a 500 and no URL. The object remains under `uploads/`, which the public image route serves. The key is a UUID, so a stranger does not guess it. Repeated failures leave the objects behind.

Fix: On a failed `put`, `deleteFromR2` every key already in `results`, then rethrow.

If we skip it: The bucket accumulates objects nobody can name from the response, and each one is still publicly readable if the key leaks later.

### 9. `grokChat` waits forever on a silent provider (`packages/modules/narduk-ai/server/utils/xai.ts:131-154`)

What this is: `grokListModels` aborts after 10 seconds. The comment there says a stalled xAI must not hold the admin request. `grokChat` and `grokChatStream` call `fetch` with no `signal`.

Problem: xAI accepts the TCP connection and sends no bytes. `grokChat` stays on `response.json()` until the Worker or the caller gives up. `chatCompletion` already bounds each attempt at 30 seconds. These two helpers do not.

Fix: Pass `AbortSignal.timeout` into `createXaiRequest`, using the same 30 second bound as `chatCompletion` for `grokChat`. For the stream, bound the wait for headers the same way.

If we skip it: One stalled provider call holds the Worker invocation until the platform kills it.

### 10. The SSE parser keeps one line without a limit (`packages/modules/narduk-ai/server/utils/xai.ts:182-221`)

What this is: `createXaiSseStreamParser` splits the provider stream on newlines and parses `data:` lines.

Problem: A chunk with no `\n` is appended to `buffer` and kept. A 50 MB body with no newline stays in that string until the stream ends. The Worker runs out of memory and the invocation dies. A normal xAI stream sends newlines. A truncated or hostile body does not.

Fix: If `buffer.length` passes 1 MiB, error the stream and drop the buffer.

If we skip it: One bad stream kills the isolate for that request and can take the Worker over its memory limit.

### 11. An SSE error frame becomes an empty success (`packages/modules/narduk-ai/server/utils/xai.ts:187-204`)

What this is: `createXaiSseStreamParser` enqueues `choices[0].delta.content` when that value is a non-empty string. Anything else is skipped. A JSON parse failure is ignored. `grokChatStream` has already logged `AI provider stream opened` once the HTTP status was 2xx.

Problem: The line `data: {"error":{"message":"model overloaded"}}` parses, has no string delta, and enqueues nothing. The stream ends empty. The caller cannot tell an empty answer from an upstream rejection. `tests/xai.test.ts` covers split content, the word `malformed`, and `[DONE]`. It does not cover an `error` object.

Fix: If the parsed payload has `error`, fail the stream with the fixed fallback sentence. Do not copy `error.message` (see finding 2).

If we skip it: Overload, auth, and content-filter failures that arrive as SSE frames are stored as an empty answer.

### 12. A non-finite `retries` never stops (`packages/modules/narduk-ai/server/utils/chatCompletions.ts:230-252`)

What this is: `chatCompletion` retries a 5xx, a network error, or a timeout `retries` times. The default is 1.

Problem: `Math.max(0, NaN)` is `NaN`, and `NaN ?? 1` does not replace `NaN`. `tries >= NaN` is false forever. `chatCompletion(messages, { retries: NaN, apiKey, model })` against a 502 fetches until the Worker is killed. `retries: Infinity` does the same. `timeoutMs: NaN` is a different miss: `setTimeout` treats it as a short delay, so every attempt aborts at once and the call returns 504.

Fix: If `retries` is not a finite integer of 0 or more, use 1. If `timeoutMs` is not a finite number above 0, use 30 seconds.

If we skip it: A bad config either hammers the provider or fails every call as a timeout.

### 13. Saving a missing system prompt reports success (`packages/modules/narduk-ai/server/api/admin/system-prompts/index.put.ts:22-36`)

What this is: `PUT` updates `system_prompts` where `name` matches, then returns `{ success: true }`.

Problem: Body `{ name: 'does-not-exist', content: 'hello' }` updates zero rows. The handler still returns success. The admin UI shows the prompt as saved. The next read still has the old content, or no row.

Fix: Read the affected row count. Return 404 when it is 0.

If we skip it: An admin edits a typo'd name, sees success, and the model keeps the previous prompt.

### 14. The chosen chat model expires after a year (`packages/modules/narduk-ai/server/utils/chatModelConfig.ts:12-21`)

What this is: `setStoredChatModel` writes the admin's model id to KV with `ADMIN_CHAT_MODEL_TTL_SECONDS` (365 days). `kvSet` passes that number as `expirationTtl`.

Problem: On day 366 the key is gone. `getStoredChatModel` returns `grok-3-mini`. Chats switch model with no write and no log. KV keeps a key forever when `put` is called without a TTL.

Fix: Call `kvSet` without a TTL.

If we skip it: A year after the last save, production silently changes model.

### 15. Saving a model and reading it back can disagree (`packages/modules/narduk-ai/server/api/admin/ai/model.put.ts:10-22`)

What this is: `PUT` accepts any non-empty string and stores it in KV. `GET`, when an API key is set, returns `resolveStoredChatModel`, which keeps the stored id only if it is in the live catalog.

Problem: The catalog contains `grok-3-mini` only. `PUT { "model": "not-a-real-model" }` returns `{ success: true, model: "not-a-real-model" }`. The next `GET` returns `{ currentModel: "grok-3-mini" }` (the first preferred id that exists, otherwise the default). KV still holds `not-a-real-model`. `getStoredChatModel` is a public export and still returns that string, so a caller that skips the catalog check sends it to xAI. There is also no max length on `model`.

Fix: In `PUT`, reject with 400 unless the id is in the same catalog `GET` uses, and cap the length.

If we skip it: The admin screen shows one model and KV holds another.

### 16. The Node body cap reads the stream before the parser does (`packages/modules/narduk-uploads/runtime/server/utils/upload.js:86-97`)

What this is: `readBoundedFormData` calls `capIncomingMessageBytes` before `readMultipartFormData`. The cap adds a `data` listener. For a live Node stream, `enforceUploadBodyByteCap` returns without reading, and the `await` yields before h3 subscribes.

Problem: A paused Node stream with one chunk `hello-body`. Attach the cap listener, then wait a turn, then attach a second `data` listener. The cap listener receives `hello-body`. The second listener receives nothing, and `readableEnded` is already true, so it also misses `end`. That is the order in `upload.post.js:57-60`. A small upload in `nuxt dev` never reaches the multipart parser. Over the cap, `req.destroy(error)` emits `error` with no listener yet. Node then throws `Unhandled 'error' event` with `statusCode: 413`, which the route's `try/catch` does not see. The unit test emits `data` only after `parseBody` resolves and mocks `readMultipartFormData`.

Fix: Do not attach `data` before the parser. Count bytes in the one reader that feeds h3, and put the bounded `Buffer` on `event._requestBody`, which the web-stream branch already does.

If we skip it: Node dev uploads hang or crash the process instead of returning 413.

### 17. `maxChars` is applied before the XML escape (`packages/modules/narduk-ai/server/utils/aiPromptResolver.ts:89-96`)

What this is: `serializeChunk` slices the raw text to `maxChars`, then escapes it, unless `trust` is `trusted`. With no `charBudget`, nothing measures the escaped length.

Problem: An untrusted chunk with `data` of 100 `&` characters and `maxChars: 100`. The slice keeps all 100. `escapeXmlText` turns each `&` into `&amp;`. The context body is 500 characters. A `<` grows four times, to `&lt;`. `charBudget`, when set, counts the escaped length. The per-chunk cap does not.

Fix: Escape first, then `applyMaxChars` on the escaped string.

If we skip it: A caller who set `maxChars` as the bound on user text sends up to five times that many characters to the model.

### 18. List `offset` has no ceiling (`packages/contracts/narduk-platform/src/list-query.ts:254-257`)

What this is: `listQuerySchema` clamps `limit` to the route's max. In offset mode, `offset` is any integer of 0 or more.

Problem: `?offset=1000000&limit=25` parses. The route then runs `OFFSET 1000000`. On a large table that walks a million rows to return 25. `limit=1e12` is rejected by the clamp. `offset` is not. Every offset-mode list route in the estate inherits this.

Fix: Reject `offset` above a ceiling (10_000 is enough for admin lists) unless the route passes a higher `maxOffset`.

If we skip it: One query string turns a list route into a long scan.

### 19. Prompt providers stampede on a cold cache (`packages/modules/narduk-ai/server/utils/aiPromptResolver.ts:240-254`)

What this is: `resolveSelectionChunk` reads the context cache, and on a miss it calls `provider.provide` and then `cache.set`.

Problem: Fifty requests arrive in the same moment for one cache key. Each one sees a miss. Each one calls `provide`. There is no single-flight map. A provider that reads D1 or Postgres does that work fifty times, then fifty writes race into the cache.

Fix: Share one in-flight `provide` per cache key, the same way `resolveSeries` shares one statement.

If we skip it: The first burst after a TTL expiry multiplies the provider's database load by the number of concurrent AI requests.

## Nice to have

### 20. `readR2AsBase64` copies the object one byte at a time (`packages/modules/narduk-uploads/runtime/server/utils/r2.js:45-51`)

What this is: The helper reads an R2 object into a binary string, then `btoa`. The upload route does not call it. It is a public server auto-import. This repo has no other caller. Other repos may. Do not delete it without checking them.

Problem: An 8 MB object runs one `binary += String.fromCharCode(...)` per byte, then base64-encodes the whole string. There is no size cap. The upload path allows 10 MB. That is a long CPU burst and a second full copy on a Worker.

Fix: Encode fixed-size slices and join those, and refuse objects over `MAX_FILE_SIZE`.

If we skip it: Any app that still calls this helper on a full-size image spends the request on the copy.

I left out 8 smaller ones: the `/favicon` skip matches any path that starts with that string, an empty manual prompt placeholder inserts the context between every character, client diagnostics will log a caller-supplied `fatal`, `Cache-Control: max-age` without `public` is not treated as a shared cache, `normalizeExtension` still rewrites `svg+xml` which the allow-list never stores, a Doppler `from` with a fourth slash keeps the wrong key (the live catalog has no `doppler:` entries), an Influx comment can hide `aggregateWindow` from the safety check, and `createLiveSocket().start()` with no `WebSocket` sticks in `closed`.

Verdict: Fix the series-unit cache, the xAI error text, and the upload multipart parse before the next release of those packages. The first changes stored data, the second hands a prompt to the client, and the third can kill a Worker on a file the route says it accepts. The other findings need a bad input, a stall, or a later failure. Upload auth and the WebSocket authoriser fail closed in this slice. status-runtime and the explorer message checks did not show a defect at this load.

Not checked: `defineUserMutation` and `defineAdminMutation` in narduk-core (auth and CSRF live there). narduk-postgres parameter chunking. A live Timescale database, a live xAI call, and a live R2 bucket. The committed `narduk-realtime` `dist/` against a fresh build. Every `libs-explorer` `app/usage/*.vue` body and the Playwright specs. Go and Python logging trees beyond their READMEs. I read `provider-console.ts` as type declarations only.
