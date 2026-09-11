---
'@narduk-enterprises/narduk-core': patch
---

Deprecate `AppEmptyState`; it is removed in the next major.

Use `NeStatePanel` from `@narduk-enterprises/narduk-shell` instead
(narduk-libs#254, components-library backlog item 7; standing decision D4, Logan
2026-09-11: "Deprecate, remove next major").

`AppEmptyState` can only say "nothing here". It cannot tell **unknown** from
**zero**, which is the distinction its callers actually need and the bug class
behind operator-portal#183, #162, #100 and #21. `NeStatePanel` carries five
readings — `empty`, `loading`, `error`, `blocked`, `absent` — gives each the
right ARIA role by construction, and never signals the reading with colour
alone.

The empty-state markup, props and rendered output are unchanged, so nothing
breaks on this release. A one-time, dev-only `console.warn` points at
`NeStatePanel`; production stays silent. The `@deprecated` JSDoc and the README
section carry the one-for-one migration mapping (`description` becomes
`message`, the default slot becomes `#action`, and the panel takes an explicit
`state="empty"`).
