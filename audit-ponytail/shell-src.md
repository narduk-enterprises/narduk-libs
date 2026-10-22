# Ponytail 5 — narduk-shell src, types, docs

Audit of `packages/design/narduk-shell/src`, `types`, and `docs` at `212392aa` (main). Read only. No source change.

What this repo does: `narduk-libs` publishes shared packages for Narduk Nuxt apps. `narduk-shell` is the `Ne*` suite: tables, paged lists, prose, a command palette, and the `./format` date and number helpers. Apps import it and render it on the server (often a Cloudflare Worker) and again in the browser.

Load I assumed: a page formats every visible cell; a list keeps one request in flight; a client table holds hundreds to a few thousand rows; a palette stores a handful of recents. The server string and the browser string for the same instant must match. I did not assume millions of rows inside one component. The Intl cache cap of 256 is a stated limit and this load does not cross it.

## Must fix

### 1. A date-time with no zone follows the machine's zone — `src/format.ts:300-306`

What this is: `instantOf` turns a string into an instant with `Date.parse`. `formatDate` and `formatDateTime` then print that instant in the `timeZone` you passed.

Problem: `Date.parse` of a date-time with no `Z` and no numeric offset uses the host zone. The same call does not match across machines.

`formatDate('2026-03-08T23:30:00', { timeZone: 'UTC', locale: 'en-US' })`

- Host `TZ=UTC`: `Mar 8, 2026`
- Host `TZ=America/Chicago`: `Mar 9, 2026`

`formatDateTime` of that same call is `Mar 8, 2026, 11:30 PM` on UTC and `Mar 9, 2026, 4:30 AM` in Chicago. A Worker in UTC and a browser in Chicago hydrate different text. This is the bug this file says it removes. A bare `YYYY-MM-DD` is fine (it is pinned to UTC noon, or `Date.parse` of a date-only string is UTC). A value that already has `Z` or `+hh:mm` is fine.

The same `Date.parse` is copied in `src/runtime/composables/use-time-ago.ts:143-149`, `src/runtime/components/NeLegalPage.vue:50-56`, and `src/runtime/components/NeDataAttribution.vue:45-49`. Fixing only `format.ts` leaves `useTimeAgo('2026-03-08T23:30:00', { timeZone: 'UTC' })` and the legal and attribution stamps wrong, because they parse before they format. No test passes an offset-less date-time. `test/format.ssr.test.ts` only uses values that already have `Z`.

Fix: In one parser, if the string has a time and no zone, parse it as UTC (append `Z`). Point the three copies at that function and delete their copies.

If we skip it: Any API or SQL value like `2026-03-08T23:30:00` shows the wrong day or the wrong hour after hydration. The page flickers or drops to a client render.

### 2. Typing a search is thrown away when the page changes — `src/runtime/composables/use-collection.ts:526-546`

What this is: With `syncQuery: true`, the URL owns `page`, `q`, and `sort`. The search box writes `q` only after a 250ms debounce (`setSearch`, lines 479-489).

Problem: The debounce keeps the letters in `searchInput` and leaves the URL on the old `q`. Any URL write in that window reads the URL back and copies it onto the box.

Concrete case: `syncQuery: true`, debounce 250. The box is bound to `c.q`. The user types `hello`. Before 250ms they open page 2. `setPage` updates `page` and `router.replace` writes `?page=2` with no `q`. The route watcher calls `readRouteQuery`, which always sets `searchInput` from the URL (line 542). The URL `q` is still empty, so the box is cleared. The timer then applies that empty string. `hello` is never searched. The cursor collection does not do this: `use-cursor-collection.ts:138` only copies `q` when the URL `q` differs from the applied term. No test types during a page change.

Fix: In `readRouteQuery`, if a debounce is pending and the URL `q` still equals the applied term, leave `searchInput` alone. If the URL `q` really changed, clear the timer and take the URL.

If we skip it: On every synced list, a page or sort click in the first 250ms of typing deletes the search.

### 3. Clearing the sort puts it back and jumps to the first page — `src/runtime/composables/use-cursor-collection.ts:132-140`

What this is: With `syncQuery: true`, the route watcher copies `sort` from the URL. If the URL has no sort, it falls back to `options.sort`.

Problem: `setSort(null)` is a public way to clear the sort. The watcher treats a missing URL sort as "use the default again".

Concrete case: `useCursorCollection({ syncQuery: true, sort: 'created:desc', fetch })`. Any Next click or applied search writes `sort=created:desc` into the URL (`syncRoute`, lines 77-81). Then `setSort(null)` removes it. The watcher runs `validSort(undefined) ?? options.sort`, gets `created:desc`, sees it is not null, calls `reset()` (cursor stack cleared, cursor null), and sets the sort back to `created:desc`. The cleared sort does not stick, and the reader is sent to the first page. `use-collection.ts` does not fall back to `options.sort` on a later URL read. `test/use-cursor-collection.test.ts` calls `setSort(null)` only with `syncQuery` off. Nothing covers this watcher.

Fix: Use `options.sort` only for the first value. On a later URL read, a missing sort is null. Do not call `reset()` when the URL simply echoes the sort you just cleared.

If we skip it: A cursor list that has a default sort cannot clear it once the URL has been written. Back and Next after a clear land on the wrong page.

## Should fix

### 4. "30 days from now" reads as "this month" — `src/format.ts:553-558`

What this is: `formatRelative` uses weeks under 30 calendar days, then `zonedMonthsBetween`.

Problem: At 30 days the month count is often 0, and 0 months is the phrase "this month".

`formatRelative('2026-04-07T12:00:00Z', { now: '2026-03-08T12:00:00Z', timeZone: 'UTC', locale: 'en-US' })` is `this month`. That is 30 days, and the calendar day is 7, which is before the 8th, so the month adjustment subtracts one and lands on 0. With `numeric: 'always'` the same call is `in 0 months`. `2026-03-31` to `2026-04-30` is also `this month`. `useTimeAgo` switches to a date at 7 days, so this hits direct `formatRelative` callers (freshness text past a week).

Fix: If the month count is 0, keep the week phrase (`Math.trunc(days / 7)`). 30 days then reads as 4 weeks.

If we skip it: A timestamp a month ahead, or 30 days ahead, is labeled as the current month.

### 5. A Date in a data-table cell uses the machine's zone — `src/runtime/components/NeDataTable.vue:276`

What this is: A cell with no `format` function is printed with `String(value)`.

Problem: `String(a Date)` is the host's local `toString`, not a fixed zone.

`String(new Date('2026-03-08T12:00:00Z'))` is `Sun Mar 08 2026 12:00:00 GMT+0000 (...)` on UTC and `Sun Mar 08 2026 07:00:00 GMT-0500 (Central Daylight Time)` in Chicago. The collection table already avoids this (`NeCollectionTable.vue:456` uses `toISOString()`). A column that passes `format` is fine. A column that leaves a Date raw is not. No test mounts a Date cell without `format`.

Fix: If the value is a Date, print `toISOString()`. Leave numbers and strings on `String(value)`.

If we skip it: A table of raw dates hydrates one hour off, or fails hydration, between a UTC Worker and a zoned browser.

### 6. A missing row cap shows no rows — `src/runtime/composables/use-row-limit.ts:38-42`

What this is: `capOf` decides how many rows `useRowLimit` keeps. The comment says a non-finite cap, including an undefined value, means no cap.

Problem: `Number.isNaN(undefined)` is false. `Math.floor(undefined)` is `NaN`. `Math.max(0, NaN)` is `NaN`. `[1, 2, 3].slice(0, NaN)` is `[]`.

Concrete case: `useRowLimit(rows, () => limit)` while `limit` is still `undefined` (the getter has not received a number yet). `visible` is empty. `NaN` itself does show every row, which is what the comment says. `undefined` does not. Nothing tests an undefined cap.

Fix: Treat `typeof n !== 'number' || !Number.isFinite(n)` as no cap (`Infinity`), except a negative number, which should stay 0.

If we skip it: A list whose cap arrives on the next tick renders as an empty list instead of the full list.

### 7. A cursor filter named limit, q, sort, or cursor is not the filter — `src/runtime/composables/use-cursor-collection.ts:69-74`

What this is: The request object spreads `filters` first, then writes `limit`, and writes `cursor`, `q`, and `sort` only when they are set. `useCollection` throws if a filter uses one of those reserved names (`use-collection.ts:320-327`).

Problem: The cursor client overwrites them, or lets them through, with no error.

Concrete case: `filters: { limit: 5 }` and a page size of 25. The request `limit` is 25. The 5 is gone. The server never sees the filter. Second case: `filters: { q: 'pump' }` and an empty search box. `appliedQ` is empty, so the spread does not replace `q`, and the request still sends `q=pump` while the box looks blank. The next typed search then replaces it. No test passes a reserved filter key.

Fix: Throw the same `TypeError` as `useCollection` when a filter key is `cursor`, `limit`, `offset`, `q`, or `sort`.

If we skip it: A filter that reuses a wire name silently changes the page size or the search, and the two collection clients disagree.

### 8. A saved command can send the browser to any address — `src/runtime/components/NeCommandPalette.vue:318-331`

What this is: Enter on a row calls `go(to)`. A path goes to `router.push`. Anything that looks absolute (`scheme:` or `//...`) goes to `window.location.assign`. Recents are read back from `localStorage` (`sanitizeRecents` in `src/runtime/utils/command-palette.ts:342` keeps any non-empty `to`). The default key is `ne-command-palette:recents`.

Problem: The saved `to` is not limited to an app path or an `http(s)` URL.

Concrete case: `localStorage['ne-command-palette:recents']` is `[{"groupId":"pages","item":{"id":"home","label":"Home","to":"//evil.example"}}]`. The user opens the palette, sees Home, presses Enter. `isAbsolute` is true for `//`, and `location.assign('//evil.example')` leaves the app. A `to` of `javascript:...` is handed to `location.assign` the same way. The palette will also store a bad `to` that a provider put on a real row, and replay it later. Nothing tests the scheme.

Fix: On read and on `go`, allow an app path, or an `http:` / `https:` URL. Drop every other `to`, including `//`.

If we skip it: One write to that localStorage key (a bad provider row, or any script on the origin) turns a later Enter into a navigation off the site. It stays after the bad row is gone.

### 9. Message links tell the other site which page you were on — `src/runtime/components/NeMessageProse.vue:116`

What this is: An `https:` link in a message is an `<a target="_blank" rel="noopener">`. Block mode goes through `NeProse` (`src/runtime/components/NeProse.vue:99`), which sets the same `rel` when `externalLinksNewTab` is on. `NeMessageProse` turns that on.

Problem: `noopener` clears `window.opener`. It does not stop the `Referer` header. `NeDataAttribution.vue:105` sets `noopener noreferrer` for the same kind of outbound link.

Concrete case: A message contains `[notes](https://example.com/notes)`. The click opens that URL in a new tab and the browser sends the full app URL as `Referer`. The link text and the `href` are otherwise safe (`https:` only, checked again at render).

Fix: Set `rel` to `noopener noreferrer` in both components.

If we skip it: Every outbound message link leaks the page URL to the other site.

### 10. A blocked-state link is not checked — `src/runtime/components/NeStatePanel.vue:235-250`

What this is: `unblocksHref` is written straight to `<a href>`. Prose and attribution both refuse a non-http(s) href. This prop does not.

Problem: A `javascript:` href runs when the link is clicked.

Concrete case: `<NeStatePanel state="blocked" unblocks-on="the feed" unblocks-href="javascript:alert(1)" />`. The anchor's click runs the script. A value from an API error payload does the same. A normal `https://` ticket link is unchanged.

Fix: Run the href through `safeAttributionHref`. If it returns nothing, render the words as text.

If we skip it: Any caller that passes a data href into the blocked state has an XSS click.

## Nice to have

### 11. A file at the root of a path is cut — `src/format.ts:821-824`

What this is: `splitTruncate(..., { kind: 'path' })` keeps the filename, including its slash, no matter how long it is.

Problem: The slash test is `slash > 0`. A path whose only slash is at the start fails the test.

Concrete case: `splitTruncate('/a-very-long-build-artifact-name.tar.gz', { kind: 'path' })` keeps the last 14 characters, not `/a-very-long-build-artifact-name.tar.gz`. `splitTruncate('/var/lib/narduk/releases/2026-10-14/a.tar.gz', { kind: 'path' })` keeps `/a.tar.gz`, which is the tested case. A name with no slash at all correctly falls back to the last 14 characters.

Fix: Change `slash > 0` to `slash >= 0`.

If we skip it: Root paths such as `/long-file-name.tar.gz` are ellipsized in the middle of the name.

### 12. A search can match across two cells — `src/runtime/utils/collection-engine.ts:85-87`

What this is: `rowMatches` joins every cell with a space, then checks `includes(query)`. The comment says the query must sit in a column, or in the row's own search text.

Problem: The join lets the match cross the boundary between two cells.

Concrete case: cells `cost` and `dog`, query `t d`. Neither cell contains `t d`. The joined string `cost dog` does, so the row matches. A query that is wholly inside one cell still matches.

Fix: Test each cell (and the row search text) with `includes`, and return true if any one matches.

If we skip it: A client table shows a row for a query that is not in any column. It is a false hit, not a missed one.

## Smaller notes left out

5. A CSV text cell that starts with a space and then `=` is not prefixed (the formula guard is only the first character). 13 days reads as "1 week" because the week count truncates. Highlighting is skipped for a string that contains an emoji (the code bails out on purpose when the folded length differs). A boolean cell sorts as missing unless the column supplies `sortValue`. An uncounted empty page jumps back to page 1; the collection code says that is the rule.

## Verdict

Not safe to ignore. Three bugs change a date, delete a search, or undo a cleared sort. Fix those before the next shell release. The other nine are real and smaller.

Lean: -20 lines, -0 dependencies possible.

Not checked: `types/nuxt-ui-sfc.d.ts` is an 12-line type stub and has no runtime. `docs/hall-of-fame.md` was read; the timeline bar does not divide by zero, and the statement hero adds "Last known" / "Status unknown" as the doc says. I did not read every design-card demo line by line. I did not re-read the marketing and admin wrapper templates (`NeHero`, `NeCta`, `NeFeatureGrid`, `NeAdmin*`) past their props; they compose other components and add no parser or request. `theme.css`, `bounce-guard.css`, `README.md`, and `test/` are outside this lane; I read the tests that sit next to the findings and did not run them. No install and no build.
