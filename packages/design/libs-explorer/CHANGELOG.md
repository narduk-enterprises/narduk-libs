# @narduk-enterprises/libs-explorer

## 0.0.2

### Patch Changes

- a07c87b: Add `NeCard`, `NeCardList` and `NeDetailView` (item 17, #264).

  The eslint-config and narduk-app-tools shared-component lists name those three
  plus `NeSearchInput` so the drift and item-13 tests match `narduk-shell`'s
  registry. Explorer inventory, catalog, and usage ship beside the components.

  `NeCard` wraps `UCard` with media, title, badge, stat rows and actions.
  `NeCardList` renders the same collection state as the table (`v-model:state`
  or `:collection`) with `NeStatePanel` and `NePager` built in, so one page
  toggles cards and table. `NeDetailView` is a key-value panel: label, value,
  format, unit, and an unavailable message that never looks like zero.

  The pin literal in `create-narduk-app`'s `PACKAGE_VERSIONS` is deliberately
  not hand-edited: `versions:check` requires it to equal narduk-shell's live
  `package.json` version, and `versions:sync` re-pins it when `release:version`
  runs.

- 1dc62db: Add `NeMeter` and the unreported treatment (#601, #602).

  `NeMeter` is one value against a known ceiling — a filled track with the
  figure beside it (`4,200 / 5,000`), in a `block` or `inline` variant. The fill
  is clamped to `[0, max]`; the figure and `aria-valuetext` always carry the
  real value, and a `max` of zero or less is a ceiling with no room rather than
  a division by zero. It is a plain element with token-read scoped CSS:
  `UProgress` is a `progressbar` whose `null` is the indeterminate "working on
  it" state, which is the wrong reading twice over.

  A figure with no producer now has its own look, distinct from zero and from
  stale. `theme.css` gains `--ne-hatch` and `--ne-hatch-soft` — 1px diagonal
  hatches derived from `--ne-ink-dimmed` and `--ne-line-strong`, declared in
  every scheme block — and the README documents the CSS contract under "The
  unreported treatment". `NeMeter` takes `:value="null"` and renders the hatched
  track, an em-dash and a `role="img"` named "…: not reported" (never
  `aria-valuenow="0"`). `NeKpiTile`'s existing `null` value now renders the same
  way: the em-dash on the soft hatch, named "Not reported", with
  `data-state="unreported"`. A reported `0` is unchanged in both.
  `isUnreported`, `NE_UNREPORTED_TEXT`, `NeMeterProps` and `NeMeterVariant` are
  exported from the package root.

  The styling-contract test now allows a `font-family` / `box-shadow` /
  `border-radius` declaration whose whole value is one `var(--ne-*)` or
  `var(--ui-*)` read, and still rejects raw values and `var()` fallbacks.
  Explorer inventory, catalog and usage ship beside the component.

- 8994b95: Add `NeSearchInput`: the debounced search field beside a collection
  (item 14, #261), the other half of `NeFilterBar`. Explorer inventory, catalog,
  and usage ship beside the component so the private showcase stays complete.

  `v-model` is the applied term, not the keystroke — the box updates as you type
  and the model updates after 250 ms, the same window `useCollection` uses for
  `q`. Bind `v-model="c.q"` with `:debounce="0"` so the two windows do not
  stack. The trailing clear empties the box and the model in the same tick; a
  reset that waited out the debounce would keep the previous term live after the
  reader asked it to stop. Length is the list-query contract's 200-character
  ceiling, so a `q` that cannot travel is never typed.

  The pin literal in `create-narduk-app`'s `PACKAGE_VERSIONS` is deliberately
  not hand-edited: `versions:check` requires it to equal narduk-shell's live
  `package.json` version, and `versions:sync` re-pins it when `release:version`
  runs.

- 1c10b9b: Phase 1c of the libs modernize review (narduk-libs#535): narduk-ui
  ships the `--ns-z-*` page and map layer scale, moves media queries from
  620/820/1080 to Tailwind `40rem`/`64rem` (small visible layout shift in every
  narduk-ui app), and maps `--bs-*` onto `--ns-*`.
  `@narduk-enterprises/stylelint-config` is the warn-level gate with a
  ratcheting per-rule and per-file budget. Stylelint 16's
  `media-feature-name-value-allowed-list` does read range syntax, so width
  values are limited to `40rem`/`64rem`. The custom rule still names the retired
  620/820/1080 scale. libs-explorer's inventory lists the new package.

## 0.0.1

### Patch Changes

- 1716307: Add the Narduk Libs Explorer (increment 1): searchable navigation,
  classified token foundations in light and dark, a catalog page with setup
  steps for every workspace package, a page for every registered narduk-shell
  component with its design card and a live, typechecked usage example, and an
  interactive NeDataTable demo whose state is the URL. Previews render in
  same-origin iframes so the tablet and phone presets are real viewports.
  Private; publishes nothing.
