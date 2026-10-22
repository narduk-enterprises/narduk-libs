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

### 4. Generated session and OG signing keys are shared by every app (`packages/contracts/narduk-platform/src/env-catalog.ts:305-312`)

What this is: `scope: 'every-app'` means the resolved value is one value shared by every app that selects the module. `generate:nonce-32` mints that value once. `one-app` is the same key shape with a different value per app.

Problem: `NUXT_SESSION_PASSWORD` is `generate:nonce-32` and `every-app`. `NUXT_OG_IMAGE_SECRET` is the same pair (`env-catalog.ts:493-501`). `CRON_SECRET` and `INDEXNOW_KEY` use `generate:nonce-32` and are `one-app`. A resolver that follows the catalog mints one session signing key and reuses it for every app on the session module. A cookie signed for app A then verifies on app B. The same reuse makes an OG signature for one app valid on the others.

Fix: Set both keys to `scope: 'one-app'`.

If we skip it: One leaked session password forges sessions for every app on that module.

### 5. A stored contract can store a catalog secret as a plaintext var (`packages/contracts/narduk-platform/src/provision-env-contract.ts:194-223`)

What this is: `normalizeRequirement` fills missing fields from the catalog, then checks that the requirement agrees with itself.

Problem: An explicit `sensitivity` and `cloudflarePlanes` win over the catalog. This document is accepted:

```json
{ "version": 1, "requirements": [{
  "key": "NUXT_SESSION_PASSWORD", "managedBy": "app", "phase": "runtime",
  "sensitivity": "plain", "canonicalProvider": "cloudflare",
  "cloudflarePlanes": ["runtime-var"]
}]}
```

The catalog entry is `secret: true` and `cf:runtime-secret`. The normalizer returns a valid requirement whose plane is `runtime-var`. The same input works for `CRON_SECRET`. The pair is internally consistent, so the secret-versus-var check does not fire.

Fix: When `getCatalogEntry(key).secret` is true, reject a plain sensitivity or a `*-var` plane.

If we skip it: The session signing key can be written as a plaintext Worker var and shown wherever plain values are shown.

## Should fix

### 6. Redaction misses compound names (`packages/modules/narduk-logging/src/sanitize.ts:145-158`)

What this is: `isSensitiveKey` redacts an exact key such as `email` or `prompt`, and it redacts a segment such as `token` inside `accessToken`.

Problem: `email`, `phone`, `address`, `latitude`, `longitude`, `prompt`, `completion`, `body`, and `payload` are only in the exact-key set. They are not segments. `sanitizeFields({ userEmail: 'a@b.com', systemPrompt: 'do not log this', homeAddress: '1 Main' })` returns those three values unchanged. `email` and `prompt` alone are redacted. `promptTokens` stays visible because `SAFE_NORMALIZED_KEYS` is checked first, so adding `prompt` as a segment does not hide token counts. The URL rule is the same kind of miss: `/(?:url|uri)$/i` strips `url` and leaves `urls` and `redirectUris` intact, so `urls: ['https://cdn.example/a?X-Amz-Signature=secret']` keeps the query.

Fix: Add those words to `SENSITIVE_SEGMENTS`. Add a fixture for `userEmail` and `systemPrompt`.

If we skip it: A log line that uses the compound name ships the email, the address, or the prompt to the sink.

### 7. In-flight resolve keys split on a character a path may contain (`packages/modules/narduk-timeseries/src/timescale/index.ts:270-273`)

What this is: Concurrent `resolveSeries` calls share one statement when their sorted cache keys join with `|`.

Problem: `seriesCacheKey` is length-prefixed because a SignalK path may contain any separator. The in-flight map joins those keys with `|` anyway. These two missing sets produce the same key: one descriptor whose path is `navigation.speed|36:22222222-2222-2222-2222-222222222222:navigation.heading` on vessel `11111111-1111-1111-1111-111111111111`, and two descriptors (`navigation.speed` on that vessel, `navigation.heading` on `22222222-2222-2222-2222-222222222222`). Whichever call starts first, the other awaits its result, does not find its own paths, and throws `SERIES_UNRESOLVED`. A retry works after the first call finishes. The write fails only while they overlap.

Fix: Use `JSON.stringify` of the sorted keys as the map key.

If we skip it: A path that contains `|` plus another cache key makes an overlapping resolve fail closed and drop the batch.

### 8. An image prefix without a slash matches the next key (`packages/modules/narduk-uploads/runtime/server/routes/images/[...slug].get.js:77`)

What this is: `GET /images/**` serves an R2 key when the key starts with a configured prefix. The module rejects an empty prefix because that would serve the whole bucket (`packages/modules/narduk-uploads/src/module.ts:89-94`).

Problem: The check is `slug.startsWith(entry.prefix)`. Prefix `v1` matches `v1/ok.png` and also `v1-private/secret.png` and `v10/a.png`. The default prefix is `uploads/`, which is safe. A configured prefix that omits the slash is not. The README examples all include the slash. The setup check does not require it.

Fix: Reject a prefix that does not end with `/` at setup, next to the empty-prefix check.

If we skip it: One missing slash publishes every key that shares that character prefix.

### 9. `grokChat` waits forever on a silent provider (`packages/modules/narduk-ai/server/utils/xai.ts:131-154`)

What this is: `grokListModels` aborts after 10 seconds. The comment there says a stalled xAI must not hold the admin request. `grokChat` and `grokChatStream` call `fetch` with no `signal`.

Problem: xAI accepts the TCP connection and sends no bytes. `grokChat` stays on `response.json()` until the Worker or the caller gives up. `chatCompletion` already bounds each attempt at 30 seconds. These two helpers do not.

Fix: Pass `AbortSignal.timeout` into `createXaiRequest`, using the same 30 second bound as `chatCompletion` for `grokChat`. For the stream, bound the wait for headers the same way.

If we skip it: One stalled provider call holds the Worker invocation until the platform kills it.

### 10. An SSE error frame becomes an empty success (`packages/modules/narduk-ai/server/utils/xai.ts:187-204`)

What this is: `createXaiSseStreamParser` enqueues `choices[0].delta.content` when that value is a non-empty string. Anything else is skipped. A JSON parse failure is ignored. `grokChatStream` has already logged `AI provider stream opened` once the HTTP status was 2xx.

Problem: The line `data: {"error":{"message":"model overloaded"}}` parses, has no string delta, and enqueues nothing. The stream ends empty. The caller cannot tell an empty answer from an upstream rejection. `tests/xai.test.ts` covers split content, the word `malformed`, and `[DONE]`. It does not cover an `error` object.

Fix: If the parsed payload has `error`, fail the stream with the fixed fallback sentence. Do not copy `error.message` (see finding 2).

If we skip it: Overload, auth, and content-filter failures that arrive as SSE frames are stored as an empty answer.

### 11. Saving a missing system prompt reports success (`packages/modules/narduk-ai/server/api/admin/system-prompts/index.put.ts:22-36`)

What this is: `PUT` updates `system_prompts` where `name` matches, then returns `{ success: true }`.

Problem: Body `{ name: 'does-not-exist', content: 'hello' }` updates zero rows. The handler still returns success. The admin UI shows the prompt as saved. The next read still has the old content, or no row.

Fix: Read the affected row count. Return 404 when it is 0.

If we skip it: An admin edits a typo'd name, sees success, and the model keeps the previous prompt.

### 12. Saving a model and reading it back can disagree (`packages/modules/narduk-ai/server/api/admin/ai/model.put.ts:10-22`)

What this is: `PUT` accepts any non-empty string and stores it in KV. `GET`, when an API key is set, returns `resolveStoredChatModel`, which keeps the stored id only if it is in the live catalog.

Problem: The catalog contains `grok-3-mini` only. `PUT { "model": "not-a-real-model" }` returns `{ success: true, model: "not-a-real-model" }`. The next `GET` returns `{ currentModel: "grok-3-mini" }` (the first preferred id that exists, otherwise the default). KV still holds `not-a-real-model`. `getStoredChatModel` is a public export and still returns that string, so a caller that skips the catalog check sends it to xAI. There is also no max length on `model`.

Fix: In `PUT`, reject with 400 unless the id is in the same catalog `GET` uses, and cap the length.

If we skip it: The admin screen shows one model and KV holds another.

### 13. The Node body cap reads the stream before the parser does (`packages/modules/narduk-uploads/runtime/server/utils/upload.js:86-97`)

What this is: `readBoundedFormData` calls `capIncomingMessageBytes` before `readMultipartFormData`. The cap adds a `data` listener. For a live Node stream, `enforceUploadBodyByteCap` returns without reading, and the `await` yields before h3 subscribes.

Problem: A paused Node stream with one chunk `hello-body`. Attach the cap listener, then wait a turn, then attach a second `data` listener. The cap listener receives `hello-body`. The second listener receives nothing, and `readableEnded` is already true, so it also misses `end`. That is the order in `upload.post.js:57-60`. A small upload in `nuxt dev` never reaches the multipart parser. Over the cap, `req.destroy(error)` emits `error` with no listener yet. Node then throws `Unhandled 'error' event` with `statusCode: 413`, which the route's `try/catch` does not see. The unit test emits `data` only after `parseBody` resolves and mocks `readMultipartFormData`.

Fix: Do not attach `data` before the parser. Count bytes in the one reader that feeds h3, and put the bounded `Buffer` on `event._requestBody`, which the web-stream branch already does.

If we skip it: Node dev uploads hang or crash the process instead of returning 413.

### 14. `maxChars` is applied before the XML escape (`packages/modules/narduk-ai/server/utils/aiPromptResolver.ts:89-96`)

What this is: `serializeChunk` slices the raw text to `maxChars`, then escapes it, unless `trust` is `trusted`. With no `charBudget`, nothing measures the escaped length.

Problem: An untrusted chunk with `data` of 100 `&` characters and `maxChars: 100`. The slice keeps all 100. `escapeXmlText` turns each `&` into `&amp;`. The context body is 500 characters. A `<` grows four times, to `&lt;`. `charBudget`, when set, counts the escaped length. The per-chunk cap does not.

Fix: Escape first, then `applyMaxChars` on the escaped string.

If we skip it: A caller who set `maxChars` as the bound on user text sends up to five times that many characters to the model.

### 15. List `offset` accepts JavaScript numeric literals (`packages/contracts/narduk-platform/src/list-query.ts:217-221`)

What this is: `limit` and `offset` go through `z.coerce.number()`, which calls `Number()`. `limit` is then clamped. `offset` is any integer of 0 or more.

Problem: `?offset=0x10` parses as 16 and skips 16 rows. `?offset=1e2` parses as 100. `?offset=9007199254740991` is a legal page request. `?limit=0x10` becomes 16 before the clamp. A query string is not a JavaScript literal. Every offset-mode list route inherits this.

Fix: Accept only a canonical decimal integer, and reject `offset` above a ceiling (10_000 unless the route passes `maxOffset`).

If we skip it: A non-decimal offset returns a different page, and one huge offset walks that many rows.

### 16. `await flush()` resolves while a record queued for that flush is still buffered (`packages/modules/narduk-logging/src/buffer.ts:98-110`)

What this is: The delivery queue. `drain` only sends records that were queued when that drain started. A second `flush()` while one is running returns the same promise. `close()` drains the leftover. `flush()` does not.

Problem: Push record 1 and start `flush()` while `send` is blocked. Push record 2. Call `flush()` again and await it. That await is the first promise. When it resolves, only record 1 was sent. Record 2 is still buffered. The follow-up timer is `unref`'d. `waitUntil(log.flush())` or a CLI exit then drops record 2.

Fix: If `flush()` is called while a drain is running, chain one more `drain()` after it and return that promise.

If we skip it: Shutdown reports success while the last records are still in memory.

### 17. The list-query README still says a typo'd filter is a 400 (`packages/contracts/narduk-platform/README.md:34-60`)

What this is: The README is the contract a route copies. The schema's default is tolerate-and-warn. `strict: true` is opt-in. The source comment says the next major flips that default.

Problem: The README says unknown keys are rejected and that `schema.safeParse({ statuss: 'idle' }).success` is `false`. That call succeeds. `filters` is `{}`, `unknownKeys` is `['statuss']`, and the route returns the unfiltered page. That is the wrong page the README says it prevents.

Fix: Document tolerate-and-warn, `unknownKeys`, and `strict: true`. Leave the default until the major that flips it.

If we skip it: A route copied from the README treats `?statuss=open` as no filter.

### 18. A Cloudflare-and-GitHub key drops the GitHub secret (`packages/contracts/narduk-platform/src/provision-env-contract.ts:208-256`)

What this is: `buildAppEnvContract` is the requirement list a readiness check evaluates. `CRON_SECRET` goes to `cf:runtime-secret` and `gh:repo-secret`. `NUXT_OG_IMAGE_SECRET` also goes to `gh:repo-secret`.

Problem: `createRequirementForKey` builds `{ key, managedBy: 'app' }`. The catalog has a Cloudflare destination, so the canonical provider is `cloudflare`. `githubScope` is copied only when the provider is GitHub. The Cloudflare result object never includes it. The built `CRON_SECRET` requirement has `cloudflarePlanes: ['runtime-secret']` and no GitHub scope. An app with the Worker secret set and the Actions secret missing still satisfies the contract.

Fix: When `to` contains a `gh:` destination, set `githubScope` on that requirement too.

If we skip it: Cron and OG workflows read as ready while the repo secret is absent.

### 19. Two `Server-Timing` values make `beforeResponse` throw (`packages/modules/narduk-logging/src/response-headers.ts:33-36`)

What this is: `mergeServerTiming` appends this request's timing to a header the handler already set. It calls `existing.trim()`.

Problem: After two `appendResponseHeader(event, 'server-timing', ...)` calls, Node's `getHeader` returns an array. `existing.trim` throws `TypeError`. h3 awaits `onBeforeResponse` before it sends the body, so the throw fails a handler that succeeded. The Fetch path joins with a comma and does not throw. This is the Node path.

Fix: If the header value is an array, join it with `, ` before `trim`.

If we skip it: A route that appends two timing metrics turns a 200 into a hook error.

## Nice to have

### 20. `readR2AsBase64` copies the object one byte at a time (`packages/modules/narduk-uploads/runtime/server/utils/r2.js:45-51`)

What this is: The helper reads an R2 object into a binary string, then `btoa`. The upload route does not call it. It is a public server auto-import. This repo has no other caller. Other repos may. Do not delete it without checking them.

Problem: An 8 MB object runs one `binary += String.fromCharCode(...)` per byte, then base64-encodes the whole string. There is no size cap. The upload path allows 10 MB. That is a long CPU burst and a second full copy on a Worker.

Fix: Encode fixed-size slices and join those, and refuse objects over `MAX_FILE_SIZE`.

If we skip it: Any app that still calls this helper on a full-size image spends the request on the copy.

I left out 14 smaller ones: `/favicon` matches any path with that prefix, an empty manual prompt placeholder inserts the context between every character, client diagnostics will log a caller-supplied `fatal`, `Cache-Control: max-age` without `public` is not treated as a shared cache, `normalizeExtension` still rewrites `svg+xml`, a Doppler `from` with a fourth slash keeps the wrong key, an Influx comment can hide `aggregateWindow`, `createLiveSocket().start()` with no `WebSocket` sticks in `closed`, a close reason longer than 123 bytes can throw on older compatibility dates, an SSE line with no newline is unbounded, `retries: NaN` never stops, the stored chat model expires after a year, a failed multi-file upload leaves the earlier object, and a cold prompt cache calls `provide` once per request. A corrupt `package.json` is reported as an app with no name, `patchPackageRegistryNpmrcContent` deletes any line containing `/api/packages/`, and `useRequestTiming({ clock: () => Date.now() })` pairs that clock with a `performance.now()` start.

Verdict: Fix the shared session signing key, the contract normalizer that can store that key as a plaintext var, the series-unit cache, the xAI error text, and the upload multipart parse before the next release of those packages. Those change who can forge a session, what is stored, or whether a Worker survives an allowed upload. The other findings need a bad input, a stall, or a later failure. Upload auth and the WebSocket authoriser fail closed in this slice. status-runtime did not show a defect at this load.

Not checked: `defineUserMutation` and `defineAdminMutation` in narduk-core (auth and CSRF live there). narduk-postgres parameter chunking. A live Timescale database, a live xAI call, and a live R2 bucket. The committed `narduk-realtime` `dist/` against a fresh build. Every `libs-explorer` `app/usage/*.vue` body and the Playwright specs. Go and Python logging trees beyond their READMEs. I read `provider-console.ts` as type declarations only.
