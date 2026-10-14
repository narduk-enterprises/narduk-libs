---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/libs-explorer': patch
'@narduk-enterprises/narduk-app-tools': patch
---

Add the generic pieces a data-dense app hand-builds today to `narduk-shell`:

- `NePageHeader` gains `lead` (a back link above the title) and `meta` (a clock
  or "as of" tag beside the actions) slots and a phone layout; markup is
  unchanged without them.
- `NeMeter` gains a multi-segment mode (`segments`: `{ value, tone, label }[]`)
  and the pure `readMeterSegments`; an unreported part draws nothing and is
  named, and a meter with no reported part takes the hatch.
- New `NeAbsent`, a cell-level unreported mark (hatch, fixed footprint, named
  "not reported", `data-ne-empty` for the phone card) with a `block` variant,
  and `absentName`.
- New `useRowLimit` composable (auto-imported) and `NeShowMore` control for
  lists that are rows rather than tables, and `showMoreLabel`.
- `NeFilterBar` gains `kind="links"`: route-linked tabs, each item a real link
  (`item.to`) in a labelled `nav`, the current page `aria-current="page"`.

The shared-component lists in eslint-config and narduk-app-tools know `NeAbsent`
and `NeShowMore`; libs-explorer lists them with usage examples.
