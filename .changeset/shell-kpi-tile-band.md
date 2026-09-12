---
'@narduk-enterprises/narduk-shell': minor
---

Add `NeKpiTile` and `NeKpiBand` (components-library backlog item 15,
narduk-libs#262; backlog narduk-libs#247; standing decision company-hq
D-WEBFOUND-2 and its 2026-09-11 amendment).

- `NeKpiTile` renders one measured metric in a `UCard`: a label, a value, and an
  optional signed delta with a caption. `value` and `delta` are formatted
  through the `./format` subpath's `formatNumber` (item 5, narduk-libs#252) when
  given as a `number` — never `Number.prototype.toLocaleString` — or rendered
  as-is when a caller passes an already-formatted `string` (e.g. from
  `formatMoney`/`formatPercent`/`createFormatters()`). Colour is never the only
  signal for the delta's direction: the text always carries an explicit sign
  (`signDisplay: 'always'`) and a ▲/▼ glyph, and `tone` colours the delta span
  only — it never changes what the delta says. An optional `#spark` slot leaves
  a sparkline (e.g. a `narduk-charts` chart) entirely to the caller;
  `narduk-shell` does not depend on `narduk-charts`.
- `NeKpiBand` lays out a responsive grid of `NeKpiTile`s via a `columns` prop
  (`Partial<Record<'base'|'sm'|'md'|'lg'|'xl', 1|2|3|4|5|6>>`, default
  `{ base: 1 }`). It only lays out — no card, border or background of its own.
  Every `grid-cols-*` class is a literal string in a lookup table rather than a
  computed template, so Tailwind's build-time scanner sees every class the
  component could ever apply.
- Adds `{ name: 'NeKpiTile', ... }` and `{ name: 'NeKpiBand', ... }` entries to
  the shared registry (`src/registry.ts`), each with an NE Base design card
  (`PENDING_CARDS` is spent, so both ship their card in this release).
