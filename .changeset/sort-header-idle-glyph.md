---
'@narduk-enterprises/narduk-shell': minor
---

`NeSortHeader` draws a muted `i-lucide-arrow-up-down` glyph on an unsorted column, so a reader can tell a header sorts before touching it; a sorted column still draws the single `i-lucide-arrow-up` or `i-lucide-arrow-down`. The button carries `data-ne-sort="idle"` at rest and `"active"` while sorted, and the idle glyph is `opacity: .45` in the component's own `@layer components` rule. `aria-sort` is unchanged (none on the `<th>` at rest). This is a visible default change for every `NeDataTable` and `NeCollectionTable` sortable header (and any direct `NeSortHeader`) in the desktop layout; the `NeCollectionTable` phone card, which draws no header buttons, is unchanged. To keep the old bare header, hide it with CSS: `[data-ne-sort='idle'] > [data-slot='trailingIcon'] { display: none }` (operator-portal#2227).
