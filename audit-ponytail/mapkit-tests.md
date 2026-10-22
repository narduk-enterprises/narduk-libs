# Ponytail 5 audit: narduk-mapkit tests and docs

What this repo does: `@narduk-enterprises/narduk-mapkit` is the shared Apple MapKit library for Narduk Nuxt apps. It signs a short-lived MapKit token, loads MapKit JS in the browser, and draws pins and vector tiles. This lane is `packages/modules/narduk-mapkit/tests` and `packages/modules/narduk-mapkit/docs` only.

Load I assumed: a published npm package used by Nuxt apps on Cloudflare Workers. A page has one map and hundreds of pins, and about one screen of vector tiles at a time. The token route is one small GET when a map opens, then the signed token is cached per origin. A Worker isolate has a tight memory cap. A preview hostname must get its own token. A forged Host must not.

I read the three docs end to end. I read the token, server, Nuxt route, fake MapKit, cache, and worker tests closely, and I checked the matching source far enough to see whether a test would fail. 11 smaller notes are left out, listed at the end.

## Must fix

### 1. Release doc tells you to tag, and to publish the frozen Nuxt package

`packages/modules/narduk-mapkit/docs/releasing.md:11-32`

What this is: The package README points publishers at this file for the GitHub Packages order. The file is 48 lines.

Problem: Follow it on today's `main`. Step 4 says `pnpm run quality` builds the Nuxt adapter with `cloudflare-module` and fails on Node built-ins. This package's `quality` script is format, lint, typecheck, and unit tests. It does not run that build. The next section says tag the commit `v1.0.0` and let the tag workflow publish core, then `@narduk-enterprises/narduk-mapkit-nuxt`. The package is `3.0.0`. `.github/workflows/release.yml` does not run on tags. It publishes when CI finishes for a `chore: release packages` commit, through Changesets (`docs/package-releases.md`). The separate Nuxt package is frozen at 2.0.x (`src/nuxt/index.ts:4-6`). A tag publishes nothing. A second publish of the frozen package would ship the old adapter.

Fix: Replace this file with a short pointer to `docs/package-releases.md`. Say the Nuxt adapter is the `./nuxt` export, and `@narduk-enterprises/narduk-mapkit-nuxt` stays frozen.

If we skip it: The next person who releases from this doc tags a commit and waits for a workflow that never starts.

## Should fix

### 2. Centralization plan still sends a new app to the frozen adapter

`packages/modules/narduk-mapkit/docs/centralization-plan.md:36-62`

What this is: A decision record from July 2026. It still reads as current direction. Nothing at the top says it was replaced.

Problem: The "Direction" section says keep Nuxt out of core and publish `@narduk-enterprises/narduk-mapkit-nuxt` as the one adapter. Migration step 2 says install that adapter and replace local `AppMapKit`. That package is frozen at 2.0.x. A new app that follows the step gets the 2.0 pin anchor (`(0, -6)` on a global 100×56 box). `docs/api-2.1.md` §c.3 says that offset is the bug this package fixed. The live module is `./nuxt` inside this package.

Fix: Add a line at the top: superseded on 2026-09-17 by `docs/api-2.1.md`. One package. New apps use `./nuxt`. Do not adopt the frozen package.

If we skip it: The next migration installs the frozen adapter and ships pins in the wrong place.

### 3. Centralization plan says a tile callback may return a bare image

`packages/modules/narduk-mapkit/docs/centralization-plan.md:85-89`

What this is: The same file tells a grid renderer how to plug into `createMapKitAsyncTileOverlay`.

Problem: It says the callback resolves to `Promise<ImageSource> | ImageSource`, and it cites `src/client/runtime.ts:44-54` and `:186-216`. The type is only `Promise<TImageSource | null>` (`runtime.ts:40-46`). The wrapper always calls `.then` on the return value (`runtime.ts:186-198`). A callback that returns an `HTMLImageElement` directly throws, the catch turns the tile into `null`, and the map stays blank. The function now starts at line 179, not 186.

Fix: Say the callback must return a Promise. Point at `runtime.ts:40-46` and `:179-206`.

If we skip it: A renderer written from this paragraph paints no tiles.

### 4. The preview-host test never leaves 127.0.0.1, and the spec still says it should be red

`packages/modules/narduk-mapkit/tests/token-route-h3.test.ts:274-301`

What this is: A test named for narduk-libs#408. The spec section it cites is `docs/api-2.1.md:507-516`.

Problem: The server listens on `127.0.0.1` (`token-route-h3.test.ts:79`). The test fetches that host and expects 200 and no `Location` header. This handler never emits `Location` on any 200. A request with `Host: pr-7.preview.example` is not sent here. The #437 block below does use that host, for the allow-list, and does not claim to be the redirect guard. `docs/api-2.1.md:514-516` still says this test is expected red until #408 lands. The test comment says #408 landed in #426. The redirect lives in narduk-core, which this file does not run. Put the canonical-host redirect back in front of `/api` on a preview host. This test stays green.

Fix: Delete this describe, or rewrite the comment so it only claims "this handler does not redirect its own host". In `api-2.1.md` §e.5, say #408 landed in #426 and the guard is in narduk-core.

If we skip it: A preview-host regression is invisible while the test name says it is covered. A reader of the spec still thinks the test is supposed to fail.

### 5. The layout-refresh test passes if the function does nothing

`packages/modules/narduk-mapkit/tests/client.test.ts:16-23`

What this is: The only test of `refreshMapKitMapLayout`.

Problem: The function reads `map.region` and writes that same value back (`src/client/layout.ts:13-16`). MapKit needs the write after a resize. The test builds `{ region }` and expects `map.region` to be the same object. Delete the body of the function. The expect still passes. Fullscreen and drawer resize then keep a stale viewport, and this test stays green.

Fix: Count writes with a setter. Expect one write when `region` is an object. Expect zero writes when `region` is `null`.

If we skip it: Removing the workaround ships with green unit tests. The bad layout shows up only in an app.

### 6. The Playwright init script never calls `load()`

`packages/modules/narduk-mapkit/tests/testing/init-script.test.ts:58-81`

What this is: The test that evaluates `fakeMapKitInitScript()` in a fresh realm. That string is what Playwright runs. The file header says a broken serialized fake must fail here.

Problem: Every case builds the map from `runtime.mapkit`. None call `runtime.load()`. `load()` is the call that returns a scoped namespace, a different object from `window.mapkit` (`src/testing/runtime.ts:1849-1869`). That split is K-10. In-process tests in `fake-mapkit.test.ts` do call `fake.load()`. They do not run the serialized source. Move a helper that only `load()` uses out of the function, or make `load()` return the global namespace. `init-script.test.ts` stays green. A page that builds pins from `window.mapkit` and the map from `load()` gets a blank map. That is the bug this file was added to catch.

Fix: After `evaluateInitScript()`, `await runtime.load({ libraries: ['map', 'annotations'] })`. Expect the result `!== runtime.mapkit`. Add one annotation built from that result and expect the scoped map to accept it.

If we skip it: The serialized fake can drift on the one call fleet browser tests actually make.

### 7. Selection tests never assign `map.selectedAnnotation`

`packages/modules/narduk-mapkit/tests/testing/fake-mapkit.test.ts:415-454`

What this is: The fake's selection coverage. The published fake is what other repos drive instead of Apple's MapKit.

Problem: The tests call `fake.inspect.selectAnnotation` and `deselectAnnotation`. Those call `applySelection` directly (`src/testing/runtime.ts:1936-1954`). The real MapKit write is the setter `map.selectedAnnotation = pin` (`runtime.ts:1102-1104`), which also logs `selectedAnnotation=`. No test in this package assigns that property. Change the setter so it stores the value and does not call `applySelection`. Every selection test still passes. An app test that sets `map.selectedAnnotation = pin` gets no select event, no callout, and `pin.selected` stays false.

Fix: In the existing selection test, select with `map.selectedAnnotation = pin` and clear with `map.selectedAnnotation = null`. Keep one `inspect.selectAnnotation` case if you still want the helper.

If we skip it: The setter can stop driving callouts and the suite stays green.

### 8. `showItems([])` and a zero-size span are untested

`packages/modules/narduk-mapkit/tests/testing/fake-mapkit.test.ts:330-341`

What this is: The only `showItems` test. Two markers, 2° apart. It expects a span of about 2°.

Problem: The implementation returns immediately on an empty list, then applies a minimum span of 0.01° (`src/testing/runtime.ts:1352-1370`). Delete the empty return. `showItems([])` leaves `minLatitude` at `Infinity`, the span becomes `NaN`, and the camera is garbage. The 2° test still passes. Delete the `0.01` floor and put both markers on the same coordinate. The span becomes 0. The 2° test still passes. A 0 span is the degenerate camera this fake otherwise records on purpose.

Fix: One test for `showItems([])`: region unchanged, no throw. One test for two markers on the same point: `latitudeDelta` and `longitudeDelta` are at least 0.01.

If we skip it: An empty fit or a stack of pins on one point can zoom the fake map to nothing, and these tests stay green.

### 9. Page-point conversion is only tested with scroll at 0

`packages/modules/narduk-mapkit/tests/testing/fake-mapkit.test.ts:985-1005`

What this is: The round trip from a pin's page point back to its coordinate.

Problem: `pageTapPoint` adds `scrollX` and `scrollY` (`src/testing/runtime.ts:1327-1329`). `convertPointOnPageToCoordinate` subtracts them (`runtime.ts:1305-1307`). happy-dom's scroll is 0, and this test never sets it. Delete the subtraction. The test still passes. Set `scrollX` to 400 and convert the pin's page point. The longitude comes back wrong, so a tap on a scrolled page hits the wrong place.

Fix: Set `globalThis.scrollX` and `scrollY` to non-zero values, convert `inspect.tapMap`'s `pointOnPage`, and expect the original latitude and longitude.

If we skip it: Scroll math can rot and every current test still passes.

### 10. The 60-second Apple Maps refresh window has no failing test

`packages/modules/narduk-mapkit/tests/apple-maps.test.ts:39-53`

What this is: The only cache test for Apple Maps server tokens. The configured JWT expires in 1800 seconds. The access token also expires in 1800 seconds. The test expects one `fetch` for two calls.

Problem: `createAppleMapsDeveloperToken` reuses `authToken` only when it is more than 60 seconds from expiry (`src/server/apple-maps.ts:149-151`). `getAppleMapsAccessToken` reuses a cached access token only when it expires more than 60 seconds from now (`apple-maps.ts:198-200`). Hand in an `authToken` whose `exp` is 30 seconds out. The function must sign a new JWT. Remove the 60-second window and it returns the old token. This test still passes. Same for an access token with `expiresInSeconds: 30`: the second call must `fetch` again. This test still passes with one `fetch`.

Fix: One test with `exp` about 30 seconds ahead. Expect a new token, not the configured string. One test with `expiresInSeconds: 30`. Expect two fetches.

If we skip it: A long-lived Worker keeps using a Maps token Apple is about to reject. The suite stays green until the 401s show up in an app.

### 11. `allowedHosts` never has to survive the Nuxt module

`packages/modules/narduk-mapkit/tests/nuxt/module.test.ts:172-178`

What this is: The module copies `rateLimit` into `runtimeConfig.nardukMapKit` and the test checks that. `allowedHosts` is copied on the next line (`src/nuxt/index.ts:169-172`) and read by the token route (`src/nuxt/runtime/server/mapkit-token.get.ts:131-137`). No test under `tests/nuxt` says `allowedHosts`.

Problem: `tests/token-route-h3.test.ts` passes `allowedHosts` straight into `mapKitTokenResponse`. It does not run the module or `mapkit-token.get.ts`. Delete the `allowedHosts` spread in `src/nuxt/index.ts`, or stop reading it in the route. Every file in `tests/nuxt` stays green. An app that set `nardukMapKit.allowedHosts: ['app.example']` then gets a 200 for `Host: evil.example`, and the JWT `origin` is `http://evil.example`. With the list wired, that request is 403 and the body has no token.

Fix: `setup({ allowedHosts: ['app.example'] })` expects that array on `runtimeConfig.nardukMapKit`. One route test with that config: `Host: app.example` is 200 with that origin, `Host: evil.example` is 403 and the body has no `token`.

If we skip it: The host allow-list can fall off the published Nuxt route and the suite stays green.

### 12. Worker binding credentials are never read in a test

`packages/modules/narduk-mapkit/tests/nuxt/token-route.test.ts:34-42`

What this is: The published token route. `beforeAll` always sets `applePrivateKey`, `appleKeyId`, and `appleTeamId` on the Nuxt runtime config.

Problem: On Workers the route reads `event.context.cloudflare.env` first (`mapkit-token.get.ts:49-54` and `:127-145`), including `APPLE_PRIVATE_KEY`. Nothing under `tests/` mentions `cloudflare`. Empty the runtime-config strings and put the three `APPLE_*` values on `event.context.cloudflare.env`. A same-origin GET should be 200 and the JWT `iss` should be the team id. Point `readCloudflareEnv` at `event.env` instead. This file still passes, because it never sets a binding. A Workers app whose secrets live only on the binding gets 503 `unconfigured` and the map never loads.

Fix: One request with empty runtime-config secrets and a `cloudflare.env` binding. Expect 200 and a signed token. Expect 503 when the binding is empty too.

If we skip it: The credential path production Workers actually use can break and these tests stay green.

### 13. `tightBuffer` has no test for a view into a larger pool

`packages/modules/narduk-mapkit/src/client/vector-tile-worker.ts:131-135` is the function. No test calls it. The worker tests live in `packages/modules/narduk-mapkit/tests/vector-tiles/worker.test.ts`.

What this is: Before a tile is posted to a worker, `tightBuffer` copies a `Uint8Array` that does not own its whole `ArrayBuffer`. The comment above it says posting `view.buffer` sends the wrong bytes and can detach a buffer the caller still holds.

Problem: `const pool = new Uint8Array([9, 9, 1, 2, 3, 4, 9, 9]); const view = pool.subarray(2, 6)`. `tightBuffer(view)` must be a 4-byte buffer `[1, 2, 3, 4]`, and `pool.buffer` must still be usable. Replace the function with `return view.buffer`. Every current worker test still passes. They build a fresh `Uint8Array`, so `byteOffset` is 0 and the copy branch never runs. The worker then decodes the padding, or the transfer detaches the pool.

Fix: One test for a `subarray` in the middle of a pool. Expect a 4-byte copy and an intact pool.

If we skip it: A decoder that returns pooled views ships the wrong bytes to the paint worker, and the suite stays green.

### 14. The 64 MiB tile budget is only checked to be greater than zero

`packages/modules/narduk-mapkit/tests/vector-tiles/cache-budget.test.ts:114-127`

What this is: The test named for the default budget. `DEFAULT_VECTOR_TILE_CACHE_BYTES` is 64 MiB (`src/client/vector-tiles.ts:781`). The overlay uses it when the caller omits `cacheBytes` (`vector-tiles.ts:1496`).

Problem: The test expects the constant to be `> 0`, then builds an overlay with `cacheBytes: Infinity` and keeps 20 tiles. Change the default parameter to `Infinity` and leave the constant at 64 MiB. This test still passes. A long pan retains every decoded tile. The explicit byte-cap cases in the same file pass a small `cacheBytes` of their own, so they stay green too.

Fix: Build one overlay with no `cacheBytes` override. Use tiles whose `decodedVectorTileBytes` add up past 64 MiB. Expect `overlay.cacheBytes <= DEFAULT_VECTOR_TILE_CACHE_BYTES`, and expect an evicted key to be read again.

If we skip it: The default cap can be disconnected from the overlay and the test stays green.

### 15. A foreign worker message is never rejected

`packages/modules/narduk-mapkit/tests/vector-tiles/worker.test.ts:18-40`

What this is: The decode-worker tests. `createChannel` delivers whatever you post. `isDecodeRequest` accepts a message only when `channel` is `narduk-mapkit/vector-tile-decode`, `id` is a number, and `bytes` is an `ArrayBuffer` (`src/vector-tiles/serve.ts:53-60`). The channel constant says a shared worker can host other protocols (`src/client/vector-tile-worker.ts:16-17`).

Problem: Every posted message in this file is a real decode request. Post `{ channel: 'other-app', id: 1, bytes: new ArrayBuffer(4) }` to a scope whose `decode` is a `vi.fn()`. `decode` must not run. Drop the channel check inside `isDecodeRequest`. This file still passes, and the shared worker decodes the other protocol's bytes.

Fix: One post with a different `channel`. Expect `decode` not to have been called.

If we skip it: Loosening the channel check stays green and a shared worker starts decoding foreign buffers.

## Nice to have

### 16. Four tests each carry their own copy of the recording canvas

`packages/modules/narduk-mapkit/tests/vector-tiles.test.ts:16-47`

What this is: `createFakeCanvas` also lives in `tests/vector-tiles/ordered-painter.test.ts:11-41`, `tests/vector-tiles/class-table.test.ts:25-55`, and `tests/vector-tiles/restyle.test.ts:12-42`. `tests/vector-tiles/fake-canvas.ts` is the same helper, and the other vector-tile tests already import it. The point-layer canvas is a different recorder (`arc` and `fill`). Leave that one.

Problem: The four copies record the same stroke fields. A later edit that adds a field to one copy and not the others makes painter asserts disagree, and nothing fails to compile.

Fix: Delete the four local copies. Import `createFakeCanvas` from `tests/vector-tiles/fake-canvas.ts`.

If we skip it: The next painter change has to be repeated in four places.

## Verdict

The token rules, the pin-anchor math, and the in-process MapKit fake are tested with real inputs. I would not release from `docs/releasing.md`, and I would not point a new app at `docs/centralization-plan.md`. The Nuxt route tests never touch the Worker binding or `allowedHosts`, so those two wires can come off with a green suite.

Lean: -120 lines, -0 dependencies possible.

Not checked: I did not run the tests. I did not read all of `app-map-kit.test.ts` (1434 lines) or every vector-tile painter assert. `src/` outside the lines cited above is another lane, as are the README, CONTRIBUTING, CHANGELOG, examples, and `dist/`. Package-root `CONTRIBUTING.md` still says Doppler and `packages/nuxt/src/`; that file is outside this lane. 11 smaller notes left out: the paint-style ring of 8, the worker's own 32 MiB default, the 1024 highlight-miss cap, `addAnnotation` returning null on a duplicate, `setCenterAnimated`, a 503 from the Nuxt route when every secret is empty (the handler itself is tested), Referer on the Nuxt route (the handler itself is tested), the SSR preload looking for the word `token` rather than a JWT, the route-level rate-limit window (the limiter unit tests cover the clock), a string `rateLimit` turning the ceiling off, and `app-map-kit.test.ts` repeating the pin-layer budgets.
