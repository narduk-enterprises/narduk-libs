What this repo does: `@narduk-enterprises/narduk-shell` (0.29.2) is the shared Ne* UI library. A Nuxt app installs the module and gets the tables, forms, shell, command palette, and `./format` helpers. The files under `packages/design/narduk-shell/test` are the unit and server-render proofs for that package.

Load I assumed: a published npm library used by Nuxt apps on Cloudflare Workers. A page holds one paged list (tens to a few hundred rows on screen), one collection request in flight, and many "time ago" labels on one shared clock. CSV is the rows on screen, opened in a spreadsheet. The first paint has no `document`. The worker locale and the reader's browser locale can differ. I treated in-memory client sort as a page, not as a million-row job.

## Must fix

### 1. Back to a cursor page drops the cursor — `src/runtime/composables/use-cursor-collection.ts:132-139`

What this is. `useCursorCollection({ syncQuery: true })` is the history for a cursor list. `test/use-cursor-collection.test.ts` (the whole file, 75 lines) never builds a router. The offset twin does, in `test/use-collection.route-sync.test.ts:169` ("follows a browser back into `?q=…&page=…` without losing the page").

Problem. The reader is on `?q=lake` (first page). They press Back. The URL is `?q=river&cursor=abc` (page 2 of the previous search). The route watcher sets `cursor` to `abc`, then sees that `q` changed and calls `reset()`, which sets `cursor` back to `null` (`use-cursor-collection.ts:117-120` and `:138`). The scope watcher then writes the URL again and deletes `cursor`. The request is the first page of `river`. The same wipe happens for any in-app open of a URL that changes `q` or `sort` and also names a `cursor`, including `?cursor=def&sort=name:asc` opened from another query. A full reload is fine, because the refs are filled from the URL before the watcher runs (`:51-54`).

Fix. Apply the URL's `cursor` after the q/sort reset, and add the back-button test the offset collection already has. The behavior change is in `src/` (other lane). This lane's gap is the missing router test.

If we skip it. Back and shared links land on the first page, and the cursor is stripped from the URL, so Forward cannot put it back.

## Should fix

### 2. A reserved filter key is sent or dropped with no error — `src/runtime/composables/use-cursor-collection.ts:69-74`

What this is. `useCollection` refuses a filter whose key is `cursor`, `limit`, `offset`, `q`, or `sort` (`use-collection.ts:318-327`, test `use-collection.test.ts:165-178`). Those keys are `LIST_QUERY_RESERVED_KEYS` in `narduk-platform`. The cursor client spreads `filters` and then overwrites some of them.

Problem. `useCursorCollection({ filters: { limit: 1, q: 'hidden', status: 'open' }, limit: 25, fetch })` with an empty search box calls `fetch` with `{ limit: 25, q: 'hidden', status: 'open' }`. `limit` from the filter is ignored. `q: 'hidden'` is sent even though the reader typed nothing. A filter named `offset` or `cursor` is sent on the first page, because those keys are copied and only replaced when the collection's own cursor is set. No test passes a colliding filter, so this stays green. `useCollection` throws and does not fetch.

Fix. Throw the same collision error before `fetch`, and add the one test `use-collection.test.ts` already has. The check belongs in `src/` (other lane).

If we skip it. A filter that reuses a reserved name returns the wrong page and looks like an empty search.

### 3. A cancelled cursor request can become the error on screen — `test/use-cursor-collection.test.ts:40-58`

What this is. The cursor client aborts the request it replaces (`use-cursor-collection.ts:112`) and ignores that failure only while `controller.signal.aborted` is set (`:100-102`). `use-collection.test.ts:306` rejects the old request and checks that it does not set `error`. The cursor test resolves the old request instead.

Problem. Delete `&& !controller.signal.aborted` from the `catch`. Type a new query so the first `fetch` rejects with `AbortError`. `error` becomes that abort, and the list shows a failure for a query the reader already left. `test/use-cursor-collection.test.ts:40-58` still passes, because it calls `resolve`, not `reject`.

Fix. Reject the superseded call and expect `error` to stay `null`, the same assertion as the offset suite.

If we skip it. The next edit to that `catch` shows a false error, and CI stays green.

### 4. A CSV cell that starts with a space still runs as a formula — `test/data-table.test.ts:117-126`

What this is. `toCsv` (`src/runtime/utils/data-table.ts:78-91`) prefixes a text cell that starts with `=`, `+`, `-`, `@`, tab, or CR, so a spreadsheet stores it as text. `NeCsvDownload` writes that string. The test locks one input: the note `=HYPERLINK("x")` becomes a quoted cell that starts with `'`.

Problem. Note value ` =HYPERLINK("x")` (space, then `=`). `FORMULA_LEAD` does not match a space. The cell is `" =HYPERLINK(""x"")"`. Excel trims the space and runs the formula. The same function is used for headers and preamble lines. The test also stays green if `+`, `@`, tab, or CR are removed from `FORMULA_LEAD`, because those characters never appear in an expected string.

Fix. After trim-for-detection, prefix any text cell whose first non-space character is in `FORMULA_LEAD`. Assert ` =HYPERLINK("x")`, `+cmd`, and `@SUM(1+1)` in `data-table.test.ts`. The prefix change is in `src/` (other lane).

If we skip it. A note or a name a reader can type becomes a formula when they open the CSV.

### 5. Client table sort follows the host locale — `src/runtime/utils/collection-engine.ts:94`

What this is. `sortRows` compares text with `localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })`. `undefined` means the process locale. `test/format.ssr.test.ts` already proves formatters must ignore `TZ` and `LC_ALL`, because the worker and the browser disagree and hydration breaks. Nothing in `test/collection-engine.test.ts` does that for sort. The names in that file are ASCII, so the order does not move.

Problem. Rows `Åland`, `Zebra`, `äpple`, sorted `name:asc`. On this machine, `LC_ALL=en-US` orders them `Åland | äpple | Zebra`. `LC_ALL=sv-SE` orders them `Zebra | Åland | äpple`. `NeCollectionTable` server-renders that order (`test/NeCollectionTable.ssr.test.ts` mounts the real table). A Swedish browser hydrating an en-US worker paint reorders the rows.

Fix. Pass a fixed locale (the same `en-US` the formatters pin, or a locale argument). Add one assertion with `Åland` / `Zebra` / `äpple`, run the same way as `format.ssr.test.ts` if the locale stays implicit. The comparator is in `src/` (other lane).

If we skip it. A text column with non-English names hydrates in a different order than the server HTML.

### 6. A new "time ago" row rewrites the shared clock — `src/runtime/composables/use-time-ago.ts:108-116`

What this is. Every `useTimeAgo()` / `NeRelativeTime` shares one 30s clock so a long list does not start one timer per row. The comment on `:110-114` says a join onto a running clock must not move that clock, because that wakes every row. `test/use-time-ago.test.ts:172-178` only covers the first row after every row has unmounted.

Problem. One row is mounted. Two seconds pass (the 30s timer has not fired). A second row mounts. `subscribers` is 2 and `Date.now() - clock.value > 1000`, so `refreshClock()` runs. Every mounted label recomputes. A feed that appends one row at a time does this on every append after the first second. Mounting 200 rows in one tick does not: they subscribe before the clock is a second old, and the existing test stays green.

Fix. Refresh only when `subscribers === 1`. Add a test: with one row alive, advance the clock 2s without firing the interval, mount a second row, and expect the first row's text to stay put until the 30s tick. The condition is in `src/` (other lane).

If we skip it. A live list of relative times rerenders the whole list on every new row.

### 7. A throwing Undo callback rejects with nobody listening — `src/runtime/composables/use-undo-toast.ts:85-94`

What this is. `show()` resolves once with `'undone'` or `'committed'` and is documented to never reject. `onUndo` / `onCommit` run inside `settle`. The button path is `void settle('undone')` (`:111-113`). The close path is `void settle('committed')` (`:123`). `test/use-undo-toast.test.ts:125-147` covers a successful `onUndo` only.

Problem. `onUndo` throws `Error('fail')`, or returns a rejected promise. `finally` still resolves `show()` with `'undone'`, so the page restores the row. `settle`'s own promise then rejects, and `void` does not catch it. That is an unhandled rejection. No test throws.

Fix. Catch the callback error, still resolve `show()` once, and add one test where `onUndo` throws. The `catch` is in `src/` (other lane).

If we skip it. A failed undo restores the row on screen and reports an unhandled rejection. The caller cannot `catch` it on `await show()`.

### 8. The palette's default navigation assigns `javascript:` URLs — `src/runtime/components/NeCommandPalette.vue:318-331`

What this is. With no `navigate` prop, a relative `to` goes through the router and any absolute `to` goes to `window.location.assign`. Absolute means a scheme (`javascript:`, `data:`) or a leading `//`. `NeProse` and `NeDataAttribution` drop `javascript:` hrefs, and their tests lock that (`test/prose.test.ts:238-251`, `test/NeDataAttribution.mount.test.ts:136-146`). `mountPalette` in `test/NeCommandPalette.mount.test.ts:45-52` always passes `navigate`, and `go()` returns before `location.assign` when that prop is set (`NeCommandPalette.vue:323-325`).

Problem. An item `{ to: 'javascript:alert(1)' }` and no `navigate` prop. Enter calls `window.location.assign('javascript:alert(1)')`. Deleting the assign branch, or assigning every scheme, does not fail the mount file.

Fix. Allow only `http:` and `https:` on the assign path (relative URLs still use the router). Mount once without `navigate` and expect `javascript:alert(1)` not to call `assign`. The allowlist is in `src/` (other lane).

If we skip it. A provider that copies a URL into `to` can navigate the browser to a script URL. The suite will not see it.

## Nice to have

### 9. One emoji turns highlight off for the whole label — `src/runtime/utils/command-palette.ts:123-128`

What this is. `highlightParts` folds the label one code point at a time, then gives up when the folded length differs from `text.length` (UTF-16). The test (`test/command-palette.test.ts:123-137`) uses `Mississippi River` and `Río`. Those lengths match.

Problem. `highlightParts('🌊 River', 'river')` returns one part, `{ text: '🌊 River', hit: false }`. The row still matches. The mark is missing because the emoji is two UTF-16 units and one code point, so the length check bails out before `indexOf`.

Fix. Walk code points, or compare by code point index. Assert the emoji label. The walker is in `src/` (other lane).

If we skip it. A label with an emoji never highlights the matched word.

6 smaller notes left out: cursor debounce not asserted on scope dispose (the offset suite asserts it); fake timers in the cursor file restored only on the success path of the last test; `previous()` from a deep link with an empty stack jumps to the first page; a filter object whose keys are the same but ordered differently resets the cursor; `+`, `-`, `@`, tab, and CR are one regex and are not separate cases (folded into finding 4); `useOptimistic` leaves the previous optimistic value when two overlapping saves both fail (`use-optimistic.ts:106-108`). That last one matches the comment in the composable and the assertion in `test/use-optimistic.test.ts:163-186`. The behavior lives in `src/` (other lane). It is a written rule, so it is not a test defect.

Verdict: The suite is strong on formatters, prose, the offset list, and most components. It never opens a router for the cursor list, so Back drops the page. Fix that test and the watcher first.

Not checked: Did not run the suite (no install, no build). `node_modules/@nuxt/ui` is not on disk, so the PageHeader/Breadcrumb stubs were not compared to `@nuxt/ui` 4.11.1; `test/support/nuxt-ui-stubs.ts` says it was read against 4.6.0. Did not line-read every `Ne*.mount.test.ts` / `Ne*.ssr.test.ts` (hero, marketing, admin, form, filter, tabs, price, settle). Read the harness (`test/support/*`, `vitest.config.ts`), registry, format, prose, message prose, collection engine, both collection composables, optimistic/undo/inline-edit/confirm/time-ago/row-limit sources, command palette engine and `go()`, CSV, meter, pager summary, and shell brand. `vitest.config.ts` is outside this lane: it rewrites `import.meta.client` to `true` and `import.meta.server` to `false` for every file outside `node_modules`, so a server-only branch in a component is not what these tests run. Other packages were not audited.
