# Ponytail audit: generator, small runtime, design

What this repo does: narduk-libs publishes the shared packages that Narduk Nuxt and Cloudflare apps install. This lane covers four of them. `create-narduk-app` writes a new app onto disk and later rewrites the generator-owned files in an existing checkout. `narduk-app` reads requests, cookies, and API errors on the live request path. `narduk-ui` draws the status instruments. `design-system-build` turns the Vue gallery into a static preview.

Load I assumed: these packages are published and reused, so a wrong template or a wrong request helper lands in many apps. `create-narduk-app` is a one-shot CLI, but its YAML and JSON are what production CI runs. `narduk-app` runs on every API request inside a Worker isolate. `narduk-ui` is rendered on dashboards, including SSR, where the Worker clock is UTC and the browser clock is not. `design-system-build` runs in CI, not on a request. I did not treat any of these as a hot loop inside one process.

20 findings below. 17 smaller ones are listed after the verdict and are not written up.

## Must fix

### 1. A form post passes the JSON reader — `packages/modules/narduk-app/src/server/request-body.ts:167-187`

What this is: `readRawJsonBody` calls h3 `readBody(event, { strict: true })` and treats only `undefined` and `null` as an empty object. The comment says a payload that is not JSON is a refusal.

Problem: h3 1.15.11 (the version in `pnpm-lock.yaml`) does not apply `strict` to every content type. `application/x-www-form-urlencoded` is parsed into an object. Body `station=B` with schema `z.object({ station: z.enum(['A','B']) })` comes back `{ station: 'B' }`. Body `to=attacker&amount=100` with `z.coerce.number()` comes back `{ to: 'attacker', amount: 100 }`. An HTML form sends that content type. h3's own `readBody` note says an authenticated handler must check the content type or it is open to CSRF. `text/plain` body `hello` is returned as a string, so `z.string()` accepts it. Content type `application/json` and body `undefined` (nine characters) is parsed by destr 2.0.5 as the value `undefined` even in strict mode, and this function then returns `{}`. An all-optional object schema succeeds. Body `{"constructor":"Alice"}` is legal JSON. destr's strict mode throws on the word `"constructor":`, h3 turns that into a 400, and this function rewrites every 400 into the "unreadable" sentence. The tests only send `application/json`.

Fix: read the raw bytes. If a body is present, require a JSON media type (`application/json` or `+json`, charset allowed) and `JSON.parse` it. Keep mapping a missing body and the four characters `null` to `{}`.

If we skip it: every route that trusts this helper treats a form post as a validated JSON body. The sibling reader in `narduk-core` (`validatedHandler.ts`, outside this lane) already answers 415 for this case.

### 2. The body reader has no size cap — `packages/modules/narduk-app/src/server/request-body.ts:172-175`

What this is: the same helper buffers the request before Zod runs.

Problem: h3 1.15.11 `readRawBody` pushes every chunk into an array and concatenates it. Nothing in `readRawJsonBody` checks `content-length` or stops a chunked body. A 20 MB JSON POST is held as one string and then parsed. A Worker isolate shares that memory with other requests on the same isolate.

Fix: reject a declared `content-length` above 1 MiB before the read, and stop a chunked read once the running total crosses 1 MiB. That is the cap `narduk-core` already uses. Take a larger cap only as an argument.

If we skip it: one large POST can exhaust the isolate. No test sends a body bigger than a few bytes.

### 3. Upgrade writes a CI pin the caller cannot start — `packages/tooling/create-narduk-app/src/upgrade.ts:524-538`

What this is: `upgrade` moves `.github/workflows/ci.yml` forward only when the bundled workflow history says the app SHA is an ancestor of `73e050ae42ece50497ff3140e21767505cca0076`. `applyCallerPermissions` records a problem when a scope the new workflow needs is already set to `none` or `read`. It does not widen that line. The comment on `SHARED_WORKFLOW_CALLER_PERMISSIONS` says a caller that grants less gets a `startup_failure` with no jobs.

Problem: `withGateEdit` (`upgrade.ts:455-471`) still sets `next` whenever the text changed. A non-empty problem list only flips the status to `unresolved`. `--write` writes any `next` (`upgrade.ts:1256-1259`) and the CLI then exits 0 (`cli.ts:362-364`). Take a caller pinned at an ancestor, for example `8192f3ddb0d383a06316542bb36cc847ab0c6895`, with `pull-requests: read`. `--write` moves the SHA to `73e050ae42ece50497ff3140e21767505cca0076` and leaves `pull-requests: read`. The required list includes `pull-requests: write`. The report says `partial`. The next CI run does not start. The test at `tests/upgrade-gate.test.ts:350-358` covers `pull-requests: read` only when the pin is already current, and the file stays unchanged.

Fix: when `permissions.problems` is non-empty, return `unresolved` with no `next`. Leave the old pin in place.

If we skip it: applying the dry-run diff breaks the next CI run, and the command reports success.

### 4. The Dependabot npm budget is one PR for two lanes — `packages/tooling/create-narduk-app/src/generate.ts:735-780`

What this is: the generated `.github/dependabot.yml` splits npm into a `safe` group (minor and patch, auto-merged) and a `majors` group (left for a person). The comment says `open-pull-requests-limit` is 2, one PR per lane.

Problem: the YAML emits `open-pull-requests-limit: 1`. Commit `22d6aeac` changed 2 to 1 inside a registry-routing fix and updated `tests/generator.test.ts` to expect 1. The comment still says 2. The earlier two-lane change (`e6c92632`) had moved this number from 1 to 2 so one lane could not fill the budget. `dependabot-merge.yml` only merges branches that start with `dependabot/npm_and_yarn/safe-` (`ci-workflow.ts:686`). One open majors PR uses the only npm slot, so the safe PR is not opened. The GitHub Packages template in `dependabot-registry.ts:189` still says 2.

Fix: put the mirror npm entry back to `open-pull-requests-limit: 2` and make the generator test expect 2.

If we skip it: every new app, and every rewrite onto this template, stalls patch and minor updates for as long as a majors PR is open.

### 5. The range bar's missing reason takes the next grid cell — `packages/design/narduk-ui/instruments/NsRangeBar.vue:75-98`

What this is: `NsRangeBar` renders the bar and, when the value is missing, a reason line.

Problem: the reason `<p>` is a second root, next to `.ns-range`. In a CSS grid each root is its own cell. `design-system-build` places two bars in `.preview-grid` (`grid-template-columns: repeat(2, minmax(0, 1fr))`, `app/app.vue:177-189` and `gallery.css:37-40`). The second bar has `missing-reason="Gauge offline"`. The grid children are bar, bar, paragraph. The paragraph lands in column 1 of the next row, under the bar that has a value.

Fix: one root. Put the paragraph inside `.ns-range` and set `grid-column: 1 / -1`.

If we skip it: a two-up row shows the reason under the neighbor, and the next station shifts by one cell.

### 6. A range bar with no label draws the track in the label column — `packages/design/narduk-ui/instruments/NsRangeBar.vue:76-107`

What this is: `label` is optional. The grid is always three columns: 108px, flexible, 72px.

Problem: the label cell is `v-if="label"`, so it is absent when the prop is empty. The track then sits in the 108px column and the value sits in the flexible column. The design card ships this call (`design-cards/NsRangeBar.card.vue:23`, value 70, unit `ft`, no label). `tests/instruments.test.ts` mounts a bar with no label and only checks the forecast marker.

Fix: when there is no label, use `minmax(0, 1fr) max-content`. When there is a label, keep the label column. Always rendering an empty label cell also works.

If we skip it: every bar whose name lives outside the component shows a short track and a value in the wrong column.

### 7. A timestamp with no zone is Live on the Worker and No data in a US browser — `packages/design/narduk-ui/_core/signal.ts:70-80`

What this is: `classifySignal` and `formatAge` parse a string with `new Date(string)`. `YYYY-MM-DDTHH:mm:ss` with no offset is local time. `YYYY-MM-DD` is UTC. Cloudflare Workers run in UTC.

Problem: I ran Node on the same string. `observedAt` `2026-07-30T11:50:00`, interval 10 minutes, `now` `2026-07-30T12:00:00Z`. With `TZ=UTC` the instant is `11:50Z`, the class is `live`, and the age is 10 minutes. With `TZ=America/Chicago` the instant is `16:50Z`, the class is `void`, and `formatAge` returns `just now` because the age is negative. A `Z` suffix parses the same on both hosts. The README examples use `Z`. The `string` argument does not require one. Passing `now` is the documented SSR path, so the server HTML says Live and a Chicago client hydrates No data.

Fix: if a date-time string has no `Z` and no numeric offset, parse it as UTC.

If we skip it: any naive ISO timestamp flips between Live and No data across SSR and the browser, and the age line says "just now" on the client.

## Should fix

### 8. The database flag is read from the first match, including comments — `packages/tooling/create-narduk-app/src/checkout-facts.ts:288-292`

What this is: upgrade decides `d1` versus `none` from the Nuxt config before it looks at bindings. `devServer.port` is read by a scanner that skips comments and strings. The database flag is a regex.

Problem: `// was databaseBackend: 'd1'` above `databaseBackend: 'none'` infers `d1`. A root app with no migrate script then gets `wrangler d1 migrations apply` in the desired manifest. The opposite comment infers `none`, so a real D1 app loses those scripts from the desired file. `databaseBackend: "none"` (double quotes) does not match, so a D1 binding in Wrangler wins. The port reader already ignores this class of text. Nothing in the checkout tests puts the flag in a comment or in double quotes.

Fix: read the flag with the same comment-and-string scan `readDevServerPort` uses, and accept both quote styles.

If we skip it: a comment or a Prettier quote choice selects the wrong backend, and `--write` adds migrate commands for an app that declared none.

### 9. The GitHub Packages Dependabot file drops the toolchain ceilings — `packages/tooling/create-narduk-app/src/dependabot-registry.ts:168-222`

What this is: `DEPENDENCY_UPDATE_LIMITS` ignores Dependabot bumps of `typescript` past `6.1.0`, `@types/node` past `25.0.0`, and `@playwright/test` past `1.61.1`. The mirror template also excludes `@narduk-enterprises/*` from the one-day cooldown. `githubPackagesDependabot()` has the cooldown days and the two groups. It has neither the `ignore` list nor the `exclude` list.

Problem: an app whose `.npmrc` points `@narduk-enterprises` at `npm.pkg.github.com`, and whose Dependabot file is not already "matching" (the match check is registry plus one-day cooldown, `dependabotMatchesRegistry`), is rewritten to this template. A missing file is created from it. Dependabot can then open `@playwright/test` `1.62.0` and `typescript` `6.1.0`, which the mirror template refuses. The policy comment says those ceilings apply to Dependabot.

Fix: build the `ignore` and `cooldown.exclude` blocks once and emit them from both templates.

If we skip it: a GitHub Packages create or rewrite removes the browser-image pin and the TypeScript ceiling the mirror apps get.

### 10. `package.json` ignores the documented opt-out — `packages/tooling/create-narduk-app/src/upgrade.ts:914-925`

What this is: the README says any managed file can be disowned by putting `narduk:unmanaged` in its first five lines. `isDisowned` is that check. `resolveKeys` (root `package.json`) and `resolveDevDependency` (`apps/web/package.json`, `upgrade.ts:1037-1044`) never call it. `package.json` is also missing from `UNMANAGED_COMMENT_SYNTAX`, so the suggested marker is a `#` comment, which is not legal JSON.

Problem: an app that puts `"description": "narduk:unmanaged"` in the first lines still has `build:ci`, `foundation:check`, and the migrate scripts replaced on `--write`. The same run adds `nuxt-security` to `apps/web/package.json` when it is absent.

Fix: call `isDisowned` at the start of both functions, and document one JSON-legal marker for those two paths.

If we skip it: the documented opt-out does not protect the two manifests upgrade edits most often.

### 11. Upgrade throws on the app name before it looks at the requested file — `packages/tooling/create-narduk-app/src/generate.ts:174-186`

What this is: every upgrade, including `--only .github/dependabot.yml`, builds the full scaffold through `normalizeOptions` (`upgrade.ts:1096`) before it filters units.

Problem: root `package.json` `"name": "@scope/harbor"` throws `Invalid app name` and writes nothing. `"narduk": { "localDevNuxtPort": 80 }` throws `local port must be an integer between 1024 and 65535` and writes nothing. A literal `devServer.port` of 80 does not throw, because `readDevServerPort` returns null below 1024 and the profile then uses 3000. `--capabilities SEO` is accepted by `create` (`normalizeCapabilities` lowercases) and throws `Unsupported capability "SEO"` on `upgrade` (`upgrade.ts:202-210` does not lowercase).

Fix: validate the name and the port only for files that embed them. Lowercase capability overrides the same way `create` does. Keep the 1024–65535 rule for a new scaffold.

If we skip it: a scoped package name or a low `localDevNuxtPort` makes every upgrade fail, including a Dependabot-only dry run.

### 12. `apiErrorMessage` throws when `message` is not a string — `packages/modules/narduk-app/src/client/api-error.ts:65-96`

What this is: the client reader turns a caught `$fetch` rejection into a sentence. `isZodIssueDump` calls `body.message.trimStart()`.

Problem: `?.` skips `null` and `undefined` only. `apiErrorMessage({ data: { message: ['name is required'], statusCode: 400 } }, 'Try again.')` throws `TypeError: body.message?.trimStart is not a function`. ofetch parses JSON, so a body that sends `"message": ["name is required"]` arrives as an array. `describeApiError` then hits the same throw on `raw.startsWith` (`api-error.ts:138-140`). This package's own `apiError` always sends a string. The reader is still the catch path for any other body.

Fix: if `message` is not a string, ignore it and use the fallback.

If we skip it: the UI catch path crashes on a validation body instead of showing the fallback. Tests only pass string messages.

### 13. Two cookies of the same name: the last one wins — `packages/modules/narduk-app/src/server/http.ts:174-226`

What this is: `readAppCookie` splits the `Cookie` header and writes into a plain object. `narduk-auth` reads `app_auth_pkce` and the Apple sign-in cookie through it.

Problem: header `app_auth_pkce=first; app_auth_pkce=second` returns `second`. h3 `getCookie` (cookie-es) returns `first`. Browsers send the longer path first and the shorter path last, so last-wins is the less specific cookie. The map is a normal object, so `readAppCookie(event, 'toString')` with no such cookie returns a function, and `Boolean(...)` is true. `session="abc"` returns the quotes as part of the value. Tests cover a single cookie only.

Fix: parse with cookie-es (first wins, null prototype, quotes stripped). If you keep the local parser, use `Object.create(null)`, stop at the first name, and strip one pair of surrounding quotes.

If we skip it: two cookies of the same name silently pick the less specific one, including the PKCE cookie.

### 14. A missing tile's reason is colored as a rise or a fall — `packages/design/narduk-ui/instruments/NsReadoutTile.vue:39-58`

What this is: when the value is missing, the delta line shows `missingReason` or "Not published". The color class still comes from `delta`.

Problem: `{ value: null, delta: -1.2, missingReason: 'Gauge offline' }` renders the words "Gauge offline" with `ns-tile__delta--down`. `{ delta: 1.2 }` paints that sentence with `ns-tile__delta--up`. The tests pass a missing value with no delta.

Fix: add `ns-tile__delta--up` or `--down` only when the value is present and the line is a real delta.

If we skip it: a gap that still carries a leftover delta reads as a fresh rise or a stale fall.

### 15. A bad `state` or `decimals` throws during render — `packages/design/narduk-ui/instruments/NsFreshnessChip.vue:97-110`

What this is: any truthy `state` is used as a key into `SIGNALS`. `formatValue` passes `decimals` straight to `Intl.NumberFormat`.

Problem: `state: "LIVE"` makes `SIGNALS["LIVE"]` undefined, and `descriptor.label` throws `TypeError` while rendering. The CSS uppercases the real labels, so `"LIVE"` is an easy value to pass from an API. On Node 22, `formatValue(1.2, { decimals: -1 })`, `{ decimals: NaN }`, and `{ decimals: 101 }` throw `RangeError: minimumFractionDigits value is out of range`. One tile with that prop fails the Worker render of the page. `{ decimals: 1.5 }` does not throw.

Fix: if `SIGNALS[state]` is missing, render `void`. If `decimals` is not an integer from 0 through 100, use the default (1 for values, 2 for deltas).

If we skip it: one bad prop is a 500, not an em dash or a No data chip.

### 16. The preview sanitizer misses imports and URLs it claims to reject — `packages/design/design-system-build/scripts/build.mts:206-235`

What this is: `renderBundle` refuses a stylesheet that contains `@import` or a non-data `url(`, and refuses card elements with `script`, `iframe`, `on*` attributes, or `src` / `srcset` / `href` that do not start with `#`.

Problem: `@import"https://evil.example/a.css"` has no space, so it does not match `@import\s`, and it has no `url(`. `splitStyles` leaves that at-rule in `styles.css`. The unit test only throws on `@import "` with a space. A card `<div style="background-image:url(https://evil.example/p.png)">` is copied through, and cards already use `style` for layout. `<img src="#." srcset="#. 1x, https://evil.example/p.png 2x">` is allowed because `srcset` starts with `#`. Current cards and `tokens.css` do not use these shapes.

Fix: after `postcss.parse`, reject any `@import` and any `url()` whose argument is not `data:`. Reject `style` values that contain `url(`, `expression(`, or `@import`. Parse `srcset` candidates. Treat `action`, `formaction`, and any attribute whose name ends in `href` as a URL.

If we skip it: a card or a dependency stylesheet can load a remote image or a remote sheet, and both `build` and `check:package` accept it.

### 17. A card file can be missing from the preview while the manifest still names it — `packages/design/design-system-build/scripts/build.mts:361-418`

What this is: the plan id comes from the registry name (`kebabCase`). The "did it render?" check compares marker ids found in the Vue source with marker ids found in the Nuxt HTML.

Problem: delete `data-design-card="ne-meter"` from `NeMeter.card.vue` and leave the file. Coverage and the prerender both have no `ne-meter` id, so the comparison passes. `cards/ne-meter.html` is not written. `coverage.shellCards` still lists `ne-meter`. `check:package` does not look at `shellCards`. The same success happens when the attribute is `data-design-card="meter"`: the file written is `cards/meter.html`, and `shellCards` still says `ne-meter`. `surface:check` in another package can still fail a normal full CI run. This package's own build comment says an authored card absent from the prerender fails here.

Fix: for each plan entry, require the card file's coverage to be exactly one id, equal to `card.id`, and require that id in the rendered set.

If we skip it: this package's `build` can certify a bundle that omits a component. All 48 cards match today.

### 18. A failed replace deletes the previous preview — `packages/design/design-system-build/scripts/build.mts:445-457`

What this is: the new tree is written to a temp directory, then `dist/design-system` is removed, then the temp directory is renamed into place. `rename` cannot replace a non-empty directory, which is why the old tree is removed first. The `finally` block deletes the temp directory.

Problem: `rm(target)` succeeds and `rename` then throws (`EPERM`, or `ENOTEMPTY` if something recreates the path). `finally` deletes the temp directory, which still holds the finished new tree. The previous tree is already gone. The command exits non-zero and `dist/design-system` does not exist. A kill between the `rm` and the `rename` does the same.

Fix: rename the old directory to a backup, rename the temp directory onto `dist/design-system`, then delete the backup. On failure, move the backup back.

If we skip it: one failed second build removes the last preview. The next successful run recreates it.

### 19. `build()` stamps today's source hashes onto yesterday's HTML — `packages/design/design-system-build/scripts/build.mts:287-398`

What this is: `build()` reads `.output/public/index.html` and then hashes the Vue, CSS, and JSON trees and `pnpm-lock.yaml`. The id comparison checks the set of `data-design-card` values, not the text inside the cards.

Problem: run a full package `build`, change the readout in `app/app.vue` from `681.2` to `999`, then run `node --experimental-strip-types scripts/build.mts` alone. Card ids still match, so the script exits 0. `cards/readouts.html` still shows `681.2`. `build-manifest.json` records the sha256 of the file that contains `999`. `check:package` re-parses the HTML it was given and does not re-hash sources. The `package.json` `build` script does run `nuxt generate` first, and CI uses that script. The second stage is also a direct entrypoint (`build.mts:468-469`).

Fix: refuse to package `.output` when it is older than the inputs, or have `check:package` recompute `sources` from the tree.

If we skip it: a local rebuild that skips `nuxt generate` reports a provenance the HTML does not have.

## Nice to have

### 20. `cardless` cannot be non-empty after a successful plan — `packages/design/design-system-build/scripts/build.mts:341-344`

What this is: `shellCardPlan` throws if a registered component is neither on disk nor in `PENDING_CARDS`. `cardless` then keeps names that are not in the plan and not pending.

Problem: that set is empty whenever `build()` gets past the plan. `coverage.missing` is `[]` whenever the registry is non-empty, and the log branch that prints "card pending" never runs. `PENDING_CARDS` is `[]` today. The empty-registry message is the only remaining case, and `check:package` already requires `missing` to be `[]`.

Fix: delete `cardless` and the branches that print it. If a waiver must be visible, record `PENDING_CARDS` on the manifest.

If we skip it: no current output change. About 15 lines stay that cannot affect a successful build.

## Verdict

Fix the body reader and the CI pin write before the next release of `narduk-app` and `create-narduk-app`. Those two put a wrong body or a dead CI file into a running app. Put the Dependabot limit back to 2 in the same generator change. The range bar and the freshness clock are the next defects a person will see on a dashboard. The other findings are real and smaller.

Lean: -15 lines, -0 dependencies possible.

17 smaller ones left out: `bandPosition` says "inside" for a `NaN` band and "below" for a reversed band; a 0.004 delta renders as an up arrow and `+0.00`; the well's median label is clipped when the median sits at the top; `formatAge` says "just now" for a future time and "NaN d" for an invalid `Date`; wrangler `"cache": false` is rewritten to `{ "enabled": true }`; `upgrade --capabilities SEO` throws while `create` lowercases it; `maxAge: 0.4` becomes `Max-Age=0`; `SameSite=None` without `Secure` is emitted and browsers drop it; a cookie with no `Path` is scoped to the response URL's directory; a partial reason-phrase table hides the built-in 404 phrase; a Zod `.strict()` refusal copies the caller's key names into the 400 body; a `data-name` containing `-->` ends the `@dsCard` comment early; a `readdir` error is reported as a missing card; `upgrade --write` does not roll back if a later file fails; the printed age can say "10 min" for up to 59 seconds after the chip has already become Aging; a header or cookie lookup for `toString` can see `Object.prototype`; a quoted cookie value keeps the quote characters.

## Not checked

I did not run the unit suites, `nuxt generate`, or `check:package`. No install. I did not line-read all of `generate.ts` (migration workflows, social previews, the analytics scaffold, brand files, every branch of the JSONC scanner, and `dist/`). I did not line-read `tokens.css` or the narduk-shell card components. Those cards are inputs to `design-system-build`; the components themselves are another lane. I did not boot workerd. The timezone result is from Node with `TZ=UTC` and `TZ=America/Chicago`, which is the same date-parse rule Workers and browsers use. h3 and destr behavior is from the tagged source that matches the lockfile (h3 1.15.11, destr 2.0.5). There is no `node_modules` in this checkout. I did not open fleet apps outside this repo. Public exports were not treated as unused. Paths outside the four packages are out of scope; the `narduk-core` body cap and the `narduk-auth` cookie call sites are cited only as evidence.
