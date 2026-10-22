What this repo does: These four packages are published libraries for Narduk Nuxt and Cloudflare Workers apps. `@narduk-enterprises/eslint-config` and `@narduk-enterprises/stylelint-config` are the CI lint gates. `@narduk-enterprises/journeys` turns a journey declaration into a Playwright or simulator run, then verify and promote decide whether that capture may be published. `@narduk-enterprises/narduk-testkit` is the dev-only Vitest and Playwright kit, including the D1, KV, and R2 fakes.

Load I assumed: lint runs in CI on an app of hundreds to a few thousand files, not on a request path. A miss is a green build. Journeys runs as CI tests plus a verify and promote gate on one capture directory. A miss publishes the wrong demo. Testkit fakes run inside unit tests, and the Playwright preset runs local and CI browser suites. A fake that disagrees with the real binding makes a broken handler look green. I did not assume high queries per second or a shared production database.

I read the package entry points, the security and Worker rules, the journey declare, run, verify, promote, and Apple driver paths, and the testkit fakes, readiness, hydration, and admin-seed paths. I probed `node:sqlite` for the D1 cases. I did not run the Vitest suites or Stylelint.

## Must fix

### 1. Verify hashes whatever path the manifest names

`packages/tooling/journeys/src/verify.ts:113-136`

What this is: In capture mode, verify checks each screenshot and the video by hashing the file the manifest names.

Problem: `path.join` keeps `..`. A new attempt directory can hold a tampered `steps/01-open-start.png` while `run.json` sets `shot` to `../OLD/steps/01-open-start.png` and `video.file` to `../OLD/video.mp4`, with the hashes of those old good files. `verifyRun` returns no issues. The new directory's own pictures are never opened. `verdict: "passed"` lets `promoteRun` move `latest`. The same string is pasted into HTML at `walkthrough.ts:125` and `walkthrough.ts:156`. A shot name `steps/01-a.png" onerror="alert(1)` that exists and matches its hash breaks out of the attribute. `promote` also writes `--run-id` straight into `latest` (`verify.ts:181`). `walkthrough.ts:85` then joins that text under `runs/`. `--run-id ../other` leaves the directory that was verified.

Fix: Allow only `steps/` plus a kebab-case file name, and `video.mp4` or `video.webm`. Resolve the path and require it to stay inside the attempt directory. Escape the URL in the HTML. Require `runId` to be the attempt directory's basename, with no slash and no `..`.

If we skip it: A capture that failed can be published by pointing the manifest at an older good run. The walkthrough page can run script from a file name.

### 2. Step ids are compared by joining on spaces

`packages/tooling/journeys/src/verify.ts:81-95`

What this is: Verify checks that the manifest ran the declared steps, in order. Declared ids are kebab-case. The manifest is not checked the same way.

Problem: `["open-start", "finish"].join(" ")` is `"open-start finish"`. A manifest with one step whose id is `open-start finish` passes that check. The next loop does `declaredSteps.get(step.id)` and `continue`s when the id is unknown, before the screenshot, prose, and `appliesIf` checks. With a matching video hash and `verdict: "passed"`, `verifyRun` returns no issues and promote accepts it. The walkthrough prints that step's `say`.

Fix: Compare length, then compare each index. An unknown id is an issue. Still require capture screenshots for every passed capture step.

If we skip it: One made-up step id can stand in for the whole declared journey, with no pictures of those steps.

### 3. Stripping semicolons makes different step bodies the same digest

`packages/tooling/journeys/src/digest.ts:114-170`

What this is: `digestJourney` hashes each step function so an old capture cannot be promoted after the step changes. Semicolons are removed so two loaders pretty-printing the same function still match.

Problem: The removal happens in code, after whitespace is collapsed. These pairs hash the same and do not do the same thing:

- `return 1;+2` returns 1. `return 1+2` returns 3.
- `const x = a;\n+ b` sets `x` to `a`. `const x = a\n+ b` sets `x` to `a + b`.

After that edit, the old capture's `journeyDigest` still matches. Verify and promote accept the old video for the new body. String and template literals keep their semicolons. This hole is only in code.

Fix: When `;` is followed by optional whitespace and `+`, `-`, `/`, `(`, `[`, or a backtick, keep a marker. Delete other semicolons, so `foo();` and `foo()` still match.

If we skip it: A behavior change in a step can ship on the previous capture.

### 4. A GET check marks the mutating fall-through as read-only

`packages/tooling/eslint-config/src/rules/utils/mutation-route.ts:742-801`

What this is: CSRF, rate limit, the mutation wrapper, and body validation all run only when `shouldGuardMutations` says the file is a mutation route. A method named in `===`, `!==`, or a `switch` case is added to the set. If every named method is GET, HEAD, or OPTIONS, the file is `read-only`.

Problem: This file is `server/api/items.ts`. Nitro serves POST on it.

```ts
export default defineEventHandler(async (event) => {
  if (event.method === 'GET') return list()
  return save(await readBody(event))
})
```

The only method added is GET, so the disposition is `read-only`. All four rules return no listeners. The same thing happens for `if (event.method !== 'GET') return save(...)`, and for `switch (event.method) { case 'GET': return list(); default: return save(...) }`, because `default` is not recorded (`mutation-route.ts:752-754`). A file that names no method stays `unspecified` on purpose, and the absence rules stay quiet there. This case is different: naming GET makes the gate call the whole route read-only.

Fix: Do not treat the named methods as the whole route unless every other branch throws or returns. An inequality against a read method, and a `default` arm, should stay `unspecified` or become `mutation`.

If we skip it: The usual "GET returns, anything else writes" handler ships with no CSRF, rate-limit, wrapper, or body-validation report.

### 5. Any callee whose name contains "csrf" clears the CSRF rule

`packages/tooling/eslint-config/src/rules/server/require-csrf-header-on-mutations.ts:216-220`

What this is: On a mutation route, the rule sets one file-level `verified` flag. A real `getHeader(event, 'x-csrf-token')` or an approved wrapper sets it. So does any callee matching `/csrf|xsrf/i`.

Problem:

```ts
export default defineEventHandler(async (event) => {
  logCsrfFailure(event)
  return transfer(await readBody(event))
})
```

`logCsrfFailure` matches. The rule reports nothing. The call does not have to be reachable, and it does not have to look at a header. The message text asks for `getHeader`, a CSRF helper, or an approved wrapper. This match is wider than that.

Fix: Count an allowlist (`assertCsrf`, `requireCsrf`, and the approved wrappers), or a `getHeader` / `getRequestHeader` / `headers.get` of a configured header name. Ignore other names that merely contain "csrf".

If we skip it: A log line, or an unused helper in the same file, silences the CSRF gate. `narduk-lint` then exits 0.

### 6. Test exemptions silence rules on routes Nitro still serves

`packages/tooling/eslint-config/src/rules/utils/path-scope.ts:175-230`

What this is: `path-scope.ts:206-209` says `server/api/deploy.test.post.ts` is a real `POST /api/deploy.test`, and that `isTestOrFixturePath` must not be used inside a route tree. The server rules switched to `isExemptTestPath` (`mutation-route.ts:363-366`). The Worker classifier did not.

Problem: `classifyWorkerRuntimeFile` returns `test-or-fixture` before any other check (`cloudflare-runtime.ts:172-178`) by calling `isTestOrFixturePath`. A `.test.` infix matches. `no-process-env-in-worker-runtime`, the global DB-client rules, and `no-supabase-client-in-global-scope.ts:51` then return no listeners. The process.env suite locks this in: filename `server/api/things.test.ts` with `process.env.API_KEY` is a valid case.

The directory half hits the server rules too. `isExemptTestPath` still returns true when a parent directory is `fixtures`, `tests`, `test`, `e2e`, `spec`, or `specs`.

```ts
// server/api/fixtures/seed.post.ts
export default defineEventHandler(async (event) => {
  db.execute(sql.raw(String(await readBody(event))))
})
```

CSRF, SQL, rate limit, body validation, and the Worker rules all return no listeners. The same file's comment says Nitro serves every module in that tree (`mutation-route.ts:357-361`).

Fix: Inside `server/api` and `server/routes`, do not exempt on a `.test.` infix or on those directory names. Keep the exemption only for files outside the route tree. Update the test that treats `server/api/things.test.ts` as non-runtime.

If we skip it: A deployed route is invisible to the security rules. One of those misses is already a passing test.

### 7. The D1 fake reports the wrong result for two writes

`packages/tooling/narduk-testkit/src/server/handlers/fake-d1.ts:16-29`

What this is: The fake runs SQL on `node:sqlite` and then fills `meta.changes`. A statement is "row-returning" if it starts with `SELECT`, `WITH`, or `PRAGMA`, or contains `RETURNING`. It is "mutating" only if it starts with `INSERT`, `UPDATE`, `DELETE`, or `REPLACE`. On the row-returning path, a non-mutating statement forces `changes` to 0 (`fake-d1.ts:141-157`).

Problem: I ran these on Node's `node:sqlite`.

`WITH c AS (SELECT 'a@b.c' AS email) INSERT INTO u (email) SELECT email FROM c` inserts the row. `changes()` is 1. `all()` returns `[]`. The fake takes the `WITH` path, decides it did not mutate, and returns `changes: 0` and `success: true`. A handler that does `if (result.meta.changes === 0) return { duplicate: true }` takes the duplicate branch. D1 reports `changes: 1` and the handler sends the mail or writes the audit row the test never ran. The `RETURNING` form returns the row and still forces `changes` to 0 here.

`prepare('INSERT INTO t (a) VALUES (1); INSERT INTO t (a) VALUES (2)')` does not throw. `run()` reports `changes: 1` and the table contains only `1`. The second statement is dropped (`sourceSQL` is only the first statement). D1 rejects a prepared statement that contains more than one statement, so production writes nothing and the request fails. A test that checks `success` and `COUNT(*) >= 1` stays green.

Fix: After stripping strings and comments, treat a leading `WITH` whose top-level statement is `INSERT`, `UPDATE`, `DELETE`, or `REPLACE` as mutating, and read `changes()`. Reject prepared SQL whose tail after the first statement is non-empty, before `run` or `all`.

If we skip it: CTE writes and multi-statement prepares pass in unit tests and fail, or do the other thing, on D1.

### 8. must() clicks a substring match

`packages/tooling/journeys/src/web.ts:310-312`

What this is: `must()` is the click. `hasControl` and `noControl` pass `exact: true` for a string name (`web.ts:203-207`). `must()` does not.

Problem: Playwright's `getByRole` name is a case-insensitive substring unless `exact` is set. Buttons `Cancel order` and `Cancel`, with `Cancel order` first in the tree: `must('Cancel')` clicks `Cancel order`. `hasControl('Cancel')` would fail. The capture goes green on the wrong control.

Fix: Pass `exact: true` for a string name, the same way `roleLocator` does.

If we skip it: A journey clicks a longer control that merely contains the declared name.

### 9. Typed text is split into extra arguments

`packages/tooling/journeys/src/apple-control.ts:176-183`

What this is: The Apple driver builds injector argv from templates. The default text template is `idb ui text --udid {udid} {text}` (`apple-control.ts:97`). `fill` substitutes, then splits on whitespace. `simctl` itself is spawned with an argument array and no shell.

Problem: Text `Jane Doe` becomes argv `['idb', 'ui', 'text', '--udid', '<udid>', 'Jane', 'Doe']`. The device does not receive `Jane Doe`. Text `--udid OTHER` becomes a second `--udid` argument. Quotes in a template are split the same way. A string `duration` is split the same way, because `define.ts` does not require `duration` to be a number.

Fix: Split the template first. If a token is exactly `{text}`, `{duration}`, or another placeholder, substitute the value as one argv element.

If we skip it: A journey that types a name or a sentence types the wrong thing, and a value that looks like a flag is passed as a flag.

## Should fix

### 10. An Apple landing can pass on the wrong screen

`packages/tooling/journeys/src/apple.ts:213-225`

What this is: After a gesture, `requires` and `forbids` are checked against the raw hierarchy text. `unchanged: true` is documented as "leave the screen exactly as it was" (`types.ts:285-294`).

Problem: The check is `haystack.includes(needle)`. `requires: ['SCHEDULED']` passes when the label is `UNSCHEDULED`. `idb ui describe-all` emits JSON, so `requires: ['201']` passes because a frame is `"x":201`. The screen can move and the beat stays green, so the next coordinate is pressed in the wrong place.

`unchanged` sets `before` to `undefined` (`apple.ts:563-566`). That turns off the "screen must have moved" check. It does not fail when the fingerprint changes. A swipe that opens a sheet still passes when the sheet contains the same `requires` text.

Fix: If the tree is JSON, match only string values. Otherwise match on token boundaries. When `unchanged` is set, still fingerprint before the gesture and fail if the fingerprint differs. Leave `kind: 'wait'` exempt.

If we skip it: A beat goes green on a different screen, and the rest of the capture presses the old coordinates.

### 11. Stylelint misses CSS that is the same value

`packages/tooling/stylelint-config/plugins/narduk-design.mjs:17-42`

What this is: `z-index` must be `var(--ns-z-*)`. Media queries must not use 620, 820, or 1080 px. `index.mjs:11-13` limits the feature named `width` to `40rem` and `64rem`. `narduk-stylelint` fails any warning.

Problem: `walkDecls('z-index')` and `walkAtRules('media')` use exact names. The px regex requires lowercase `px` glued to those digits. These are the banned values and match nothing:

- `.a { Z-INDEX: 9 }`
- `@media (min-width: 620PX) { a { color: red } }`
- `@media (min-width: 620.0px)` and `@media (min-width: 0620px)`

The allow-list does not cover `min-width` or `max-width`, so it does not save those. `@media (min-width: 620px)` does warn. `.a { z-index: .620px }` also warns, because `\b` sits between `.` and `6`. That length is 0.62px.

Fix: Walk `/^z-index$/i` and `/^media$/i`. Match a length whose number is 620, 820, or 1080 with a case-insensitive `px` unit, including leading zeros and a `.0` fraction. Do not treat `.620px` as 620.

If we skip it: An uppercase property or a `620px` spelling on `min-width` is a clean lint run.

### 12. import process from 'node:process' is invisible

`packages/tooling/eslint-config/src/rules/cloudflare/no-process-env-in-worker-runtime.ts:111-126`

What this is: Worker runtime must not read `process.env`. The rule covers `process.env`, `globalThis.process.env`, `self`, `window`, a one-hop alias, and `const { env } = process`. `GLOBAL_OBJECTS` is `globalThis`, `self`, and `window` (line 40).

Problem: An import is a local binding, so it has defs, and a local named `process` is treated as a shadow.

```ts
import process from 'node:process'
export default defineEventHandler(() => process.env.API_KEY)
```

No report. `global.process.env.API_KEY` is not a report either. `globalThis.process.env` still is.

Fix: Treat an import from `node:process` or `process` as the process object. Add `global` next to `globalThis`.

If we skip it: The typed Worker pattern reads env with a green lint run.

### 13. or() of a primary key is treated as one row, and a stored select is not a list

`packages/tooling/eslint-config/src/rules/server/require-limit-on-drizzle-list-queries.ts:241-244`

What this is: The server pack runs this rule at error. `eq` on a primary-key column is allowed with no `.limit()`, because that is one row. `and` and `or` both use `.some(isPrimaryKeyCondition)`.

Problem:

```ts
await db.select().from(users).where(or(eq(users.id, id), eq(users.orgId, orgId)))
```

One arm is a primary-key equality, so the rule returns. The query is not one row.

A select stored in a local is also skipped. `analyzeThenable` only runs on an awaited, returned, or arrow-body call (`require-limit-on-drizzle-list-queries.ts:395-405`).

```ts
const rows = db.select().from(users)
return rows
```

The return value is an identifier, so the chain is never analyzed. Nitro awaits that thenable. `return db.select().from(users)` is still caught. `findMany()` is still caught.

Fix: Require every arm of `or` to be a primary-key condition. Keep `.some` only for `and`. When a variable is initialized with a `select().from()` chain, analyze that chain.

If we skip it: Those full scans stay at no diagnostic. The rule is `error`.

### 14. One schema.parse clears every other use of that query

`packages/tooling/eslint-config/src/rules/server/require-validated-query.ts:147-158`

What this is: `getQuery(event)` assigned to a variable must be passed to a schema parse. The check uses `references.some`.

Problem:

```ts
const query = getQuery(event)
await db.find(query.name)
querySchema.parse(query)
```

One reference is a parse argument, so `some` is true and the rule returns. `query.name` was already used raw. A different variable named `query` is still reported.

Fix: Report when any read of the variable is not the parse argument and not the parsed result.

If we skip it: The unvalidated field can be used first. The later parse does not cover it.

### 15. timeout: undefined counts as a bounded fetch

`packages/tooling/eslint-config/src/rules/server/require-fetch-timeout.ts:89-95`

What this is: `fetch`, `$fetch`, and `ofetch` in server code must pass `signal` or `timeout`. The rule returns as soon as a property key is one of those names. It does not read the value. The drizzle limit rule already rejects `limit: undefined`.

Problem:

```ts
await $fetch('https://upstream.example/pay', { timeout: undefined })
await fetch(url, { signal: null })
```

No report. ofetch treats a missing timeout as no timeout. A spread in the options object is an intentional pass (the comment at line 19).

Fix: Ignore `undefined`, `null`, and `void 0`.

If we skip it: A stalled upstream holds the Worker for the wall-clock budget, and the lint run is green. The rule is `warn`, and `narduk-lint` fails warnings, so this miss is a pass.

### 16. Two scenarios share one attempt directory per UTC second

`packages/tooling/journeys/src/verify.ts:200-230`

What this is: `makeRunId` formats the start time as UTC and strips the fractional second. `runPaths` keys the directory by environment, surface, journey, profile, mode, and that id. There is no scenario id.

Problem: Web test mode runs every scenario (`web.ts:497`). Two scenarios of one journey that start in the same UTC second both write `runs/<stamp>-<commit8>/run.json`. The later write replaces the earlier manifest. A failed scenario can be replaced by a later pass in that same second. `journeys verify` on the directory then sees only the survivor. Capture mode runs one scenario, so one capture process does not hit this. Two captures of the same journey in the same second, into one `outRoot`, do.

Fix: Put the scenario id in the attempt path, and keep milliseconds in the stamp.

If we skip it: A failed scenario's manifest disappears, and verify reports the scenario that finished last.

### 17. The hydration wait can return before Nuxt hydrates

`packages/tooling/narduk-testkit/src/e2e/fixtures.ts:51-64`

What this is: `waitForVueHydrated` is the barrier specs are told to use. The shared `page` fixture fails a test whose console logged a hydration mismatch (`fixtures.ts:27-32`). It scans the log as soon as the test function returns.

Problem: The candidates are `#__nuxt`, then each direct child of `body`. The function returns on the first element that has `__vue_app__`. If `#__nuxt` is not mounted yet, a Vue widget on `body` with no `$nuxt` matches `app.$nuxt === undefined`, which the function treats as already hydrated. `waitForVueHydrated` returns while Nuxt is still hydrating.

A spec that calls the deprecated `waitForHydration` (document `load` only) and returns can do so before Vue logs `Hydration completed but contains mismatches.` The fixture has already scanned an empty log. The test stays green. `warmUpApp` uses a plain page and never installs the reporter.

Fix: Prefer `#__nuxt` when it is in the document, and do not return because some other Vue root has mounted. Before the console scan, if the document has `#__nuxt`, `await waitForVueHydrated` with a short timeout.

If we skip it: The check that exists to fail hydration mismatches passes the test that has one.

### 18. Warm-up treats HTTP 500 as ready

`packages/tooling/narduk-testkit/src/e2e/fixtures.ts:151-159`

What this is: The readiness setup loads `/` once and treats a returned promise as success. `page.goto` resolves on an HTTP error document.

Problem: `/` returns 500. `warmUpApp` does not read the response status. The setup test passes. `/api/health` can still be `ok`. Specs then run against a server that has not served a successful document. There is no retry.

Fix: Require the response status to be 2xx or 3xx, and retry until the readiness deadline.

If we skip it: The gate that is supposed to stop the suite says the app is ready while the page is a 500.

### 19. R2 and KV fakes keep the caller's objects

`packages/tooling/narduk-testkit/src/server/handlers/fake-r2.ts:21-26`

What this is: The fakes stand in for the Workers bindings. Strings and views are copied. A `Buffer` passed to R2 `put` is stored as the same allocation. KV stores `putOptions.metadata` by reference (`fake-kv.ts:218`).

Problem: An upload handler fills one pooled `Buffer`, puts key `a`, refills it, and puts key `b`. `get('a')` returns `b`'s bytes. A test that only reads `b` passes. Production R2 still has `a`'s bytes. The same aliasing hides a handler that zeroes the buffer after `put`: the fake's later `get` looks scrubbed.

KV: `put('session', token, { metadata: { role: 'user' } })`, then the handler sets `metadata.role = 'admin'` on that object. `getWithMetadata` returns `admin`. Production still has `"role":"user"`.

`list({ limit: 0 })` is not rejected (`fake-kv.ts:136-157` only rejects `limit > 1000`). The page is empty, `list_complete` is false when any keys exist, and the cursor stays put. A handler that pages until `list_complete` never finishes. The file already says the cursor is a plain offset, not KV's opaque token. That part is a decision. `limit: 0` is not.

Fix: `return Buffer.from(value)` in the R2 normalizer. Store `JSON.parse(JSON.stringify(metadata))` and throw on a value that is not JSON. Reject a list limit that is not an integer from 1 to 1000.

If we skip it: Tests pass on shared memory and on a list loop that production does not exhibit.

### 20. A scenario that runs no steps can still be promoted

`packages/tooling/journeys/src/define.ts:75-100`

What this is: `defineCatalog` rejects a journey with no steps, and a step whose `skipWhen` names every scenario. It does not reject a scenario for which every step is skipped. Capture runs `scenarios[0]` only (`web.ts:497`).

Problem:

```ts
scenarios: ['base', 'extra']
steps: [{ id: 'only-extra', skipWhen: { scenarios: ['base'] }, /* ... */ }]
```

`defineCatalog` accepts it. `expectedStepIds(journey, 'base')` is `[]`. The runner executes nothing, leaves the failure unset, and sets `verdict: 'passed'` when the world confirms (`web.ts:675`). Capture still attaches a video of the start screen. Verify compares `[]` with `[]`. With a matching video hash and `journeyDigest`, it returns no issues. Promote publishes a demo whose outcome describes a walk that performed no beat.

Fix: For each declared scenario, require `expectedStepIds` to be non-empty. At least require it for `scenarios[0]`, because that is the capture scenario.

If we skip it: A capture of the start screen is a passed, promotable journey.

## Nice to have

None in this list.

25 smaller cases are left out. The largest are: `fill('Select trailer')` is treated as a CSS selector (`web.ts:192-200`); the auth-session kits only lock `/api/admin/users`, `/api/auth/me`, and `/api/auth/login`, and the stamp test only checks the timestamp shape (the real path policy is in `narduk-auth`, another lane); verify accepts a manifest with both generation fields removed (`verify.ts:72`); `stylelint-budget.mjs:90-92` ignores `maxWarnings` and treats `"rules": null` as empty, while `eslint-config/lint-budget.mjs:189` rejects `maxWarnings`; `lazyEventHandler` is a handler call but not a raw-handler name (`mutation-route.ts:96-104`, `no-raw-define-event-handler-in-mutation-routes.ts:46-51`).

Also left out, each with a concrete case I checked: `point()` is not exact; `CI=false` lifts the local E2E budget and skips worktree port derivation; the shared auth URL regex is unanchored and the `Secure` cookie check is case-sensitive; a fixture route key `/api/items` also answers `/api/items-archived`; quarantine collection returns false when a row has no tags and no source; the simulator lease is renewed once per scenario, not during it, and the file has no `0o600`; a web capture with no video file still has `verdict: 'passed'`; `record()` can accept a file after `SIGKILL`; promote does not require `mode: 'capture'`; the world-query `fetch` has no deadline and follows redirects; `see` looks only at `locator.first()`; UI-quality full-page capture uses `screenshot({ fullPage: true })`; the walkthrough does not copy media beside the HTML; client CSRF mode ignores `useFetch`; `getRequestHeaders` is listed but the check reads argument 2; `@import` media conditions and `@property --bs-*` are invisible to the stylelint plugin; a NaN web viewport passes `define.ts:44`; each Worker rule stats ancestor directories per file; `checkAuth()` clears the webhook rule; directory digests skip symlinks.

I did not call these comments findings. A method-less route stays unspecified on purpose (`mutation-route.ts:832-839`). A secret-named header read is what the webhook rule says it checks (`no-csrf-exempt-route-misuse.ts:14-17`). `page.clock` zeroing request counts is documented (`request-accounting.ts:62-66`). The stylelint flags that do nothing are documented in that package's README.

Verdict: The publish gate and the mutation classifier are the breaks I would fix before the next release. Verify can accept another run's bytes or one step id in place of two, the digest collides across a real statement change, and a GET fall-through is linted as read-only. The D1 fake returns the wrong write result. The rest are real and narrower.

Not checked: `eslint-config` `src/rules/general/*` except `prefer-safe-parse-in-event-handlers.ts`, most of `src/rules/vue/*`, `e2e-timeout-ceiling.ts`, `prefer-db-batch.ts`, `no-sequential-awaited-io-in-event-handler.ts`, `shared-components.ts`, the design-system, a11y, seo, template, formatting, and complexity packs, and `eslint-app-config.mjs` past its composition shape. `DESIGN.md` only for `shortcut:` and `ponytail:` (none). Journeys' external runner spec, `dist/`, and the Vitest suite (not executed). Testkit `accessibility.ts` after the baseline, `contracts/notifications.ts`, `analytics.ts`, and the Playwright test files past the assertions I cited. Stylelint was not executed; the misses follow from the walker and the regex. `narduk-auth` and `narduk-core` are other lanes; I opened the auth-session path helper and the health status shape only to judge the kit. No other package in this repo.
