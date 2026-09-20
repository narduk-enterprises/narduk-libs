---
'@narduk-enterprises/narduk-shell': minor
---

Add `NeFilterBar`: the filter row above a collection (item 14, #261), promoted
from operator-portal's `FilterBar.vue`. Three kinds share one DOM shape and
differ in meaning — `chips` and `facets` carry `aria-pressed`, `tabs` is a real
`tablist` with the APG keyboard model (arrows wrap, Home and End jump, exactly
one tab in the page's tab order).

A control whose producer does not exist yet stays in the row as `aria-disabled`
rather than being dropped, with the row's `note` saying when it lands — removing
it would make a product look finished and be silently narrower than it claims.
It is `aria-disabled` and not the `disabled` attribute, so a keyboard user can
still reach the reason in its `title`.

Counts are the caller's figures, rendered and never derived; an omitted count
renders no element at all, because `0` is a measurement and "not counted" is
not.

`NeSearchInput`, the other half of #261, is not in this change.
