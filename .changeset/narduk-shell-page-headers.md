---
'@narduk-enterprises/narduk-shell': minor
---

Add `NePageHeader` and `NeSectionHeader` to `@narduk-enterprises/narduk-shell`
(components-library backlog item 9, narduk-libs#256).

`NePageHeader` wraps Nuxt UI `UPageHeader` and `UBreadcrumb`: `title`,
`description`, `eyebrow`, `breadcrumbs` (UBreadcrumb item shape, rendered above
the title and omitted when empty), `#actions` (right-aligned), and a
pass-through of `UPageHeader`'s default slot. The heading is an `h1` by default
and is configurable via `as`.

`NeSectionHeader` takes `title`, optional `count` (a token-themed `UBadge` next
to the title, hidden when `undefined`), and `#actions`. The heading is an `h2`
by default and is configurable via `as`.

Both components read Nuxt UI semantic tokens and do not hardcode colour, radius,
shadow or font.
