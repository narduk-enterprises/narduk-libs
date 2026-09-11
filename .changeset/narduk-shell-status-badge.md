---
'@narduk-enterprises/narduk-shell': minor
---

Add `NeStatusBadge` and `defineStatusMap` (components-library backlog item 8,
narduk-libs#255; backlog narduk-libs#247; standing decision company-hq
D-WEBFOUND-2 and its 2026-09-11 amendment).

- `NeStatusBadge` wraps Nuxt UI's `UBadge` with a fixed
  `tone -> semantic colour` mapping (`ok`/`warn`/`error`/`info`/`neutral` to
  `success`/`warning`/`error`/`info`/`neutral`, `pending` to `neutral` with a
  `subtle` variant and a default leading icon), so no app hand-rolls its own
  tone map again (operator-portal#156). The label never wraps mid-word or
  truncates unless the `truncate` prop is explicitly set, and the tone is always
  folded into the accessible name (`aria-label="<tone>: <label>"`), so colour is
  never the only signal.
- `defineStatusMap<T extends string>(map)` turns a domain-specific status union
  into a typed `(key: T) => { tone, label }` lookup: a map missing a union
  member is a compile-time error, and an unmapped runtime value falls back to
  `{ tone: 'neutral', label: '<raw key>' }` instead of throwing. It is exposed
  as a Nuxt auto-import via `addImports`.
- Adds a `{ name: 'NeStatusBadge', filePath: ... }` entry to the shared registry
  (`src/registry.ts`).

The NE Base card treatment is deferred to item 3's mechanism; `NeStatusBadge`
ships as a standalone component in this release.
