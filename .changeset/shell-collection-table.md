---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/libs-explorer': patch
---

Add `NeCollectionTable` and `useClientCollection()` (narduk-libs#1400): one
sortable, searchable, filterable table over rows the page holds, merging
operator-portal's `KitTable` and `CollectionTable`. Header sort with missing
values last in both directions and `aria-sort` on the header cell, a built-in
toolbar (search, chips counted within the search, a count) from 25 rows, a
number, `'always'` or never, groups (sorted within each group, or with
`groupSort: 'across'` across all of them with a "Back to groups" control), row
links, selection, a row limit with "Show all", the bounded-read footer, a
missing-value prop and slot, explicit table roles, and a phone layout (cards or
columns) with a 44px tap floor. The engine is also exported as pure functions
(`collectRows`, `sortRows`, …), and `useClientCollection()` gives `NeDataTable`
a client mode without changing its contract.

The Explorer gains a `ne-collection-table` example and usage source.
