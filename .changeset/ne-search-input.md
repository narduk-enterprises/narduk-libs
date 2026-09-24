---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/libs-explorer': patch
---

Add `NeSearchInput`: the debounced search field beside a collection (item 14,
#261), the other half of `NeFilterBar`. Explorer inventory, catalog, and usage
ship beside the component so the private showcase stays complete.

`v-model` is the applied term, not the keystroke — the box updates as you type
and the model updates after 250 ms, the same window `useCollection` uses for
`q`. Bind `v-model="c.q"` with `:debounce="0"` so the two windows do not stack.
The trailing clear empties the box and the model in the same tick; a reset that
waited out the debounce would keep the previous term live after the reader
asked it to stop. Length is the list-query contract's 200-character ceiling, so
a `q` that cannot travel is never typed.

The pin literal in `create-narduk-app`'s `PACKAGE_VERSIONS` is deliberately not
hand-edited: `versions:check` requires it to equal narduk-shell's live
`package.json` version, and `versions:sync` re-pins it when `release:version`
runs.
