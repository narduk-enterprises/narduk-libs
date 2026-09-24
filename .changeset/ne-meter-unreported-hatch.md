---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/libs-explorer': patch
---

Add `NeMeter` and the unreported treatment (#601, #602).

`NeMeter` is one value against a known ceiling — a filled track with the figure
beside it (`4,200 / 5,000`), in a `block` or `inline` variant. The fill is
clamped to `[0, max]`; the figure and `aria-valuetext` always carry the real
value, and a `max` of zero or less is a ceiling with no room rather than a
division by zero. It is a plain element with token-read scoped CSS: `UProgress`
is a `progressbar` whose `null` is the indeterminate "working on it" state,
which is the wrong reading twice over.

A figure with no producer now has its own look, distinct from zero and from
stale. `theme.css` gains `--ne-hatch` and `--ne-hatch-soft` — 1px diagonal
hatches derived from `--ne-ink-dimmed` and `--ne-line-strong`, declared in every
scheme block — and the README documents the CSS contract under "The unreported
treatment". `NeMeter` takes `:value="null"` and renders the hatched track, an
em-dash and a `role="img"` named "…: not reported" (never `aria-valuenow="0"`).
`NeKpiTile`'s existing `null` value now renders the same way: the em-dash on the
soft hatch, named "Not reported", with `data-state="unreported"`. A reported `0`
is unchanged in both. `isUnreported`, `NE_UNREPORTED_TEXT`, `NeMeterProps` and
`NeMeterVariant` are exported from the package root.

The styling-contract test now allows a `font-family` / `box-shadow` /
`border-radius` declaration whose whole value is one `var(--ne-*)` or
`var(--ui-*)` read, and still rejects raw values and `var()` fallbacks.
Explorer inventory, catalog and usage ship beside the component.
