---
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/create-narduk-app': patch
---

Add `NeCard`, `NeCardList` and `NeDetailView` (item 17, #264).

The eslint-config shared-component list names those three plus `NeSearchInput`
so `shared-components-drift` matches `narduk-shell`'s registry.

`NeCard` wraps `UCard` with media, title, badge, stat rows and actions.
`NeCardList` renders the same collection state as the table (`v-model:state` or
`:collection`) with `NeStatePanel` and `NePager` built in, so one page toggles
cards and table. `NeDetailView` is a key-value panel: label, value, format,
unit, and an unavailable message that never looks like zero.

The pin literal in `create-narduk-app`'s `PACKAGE_VERSIONS` is deliberately not
hand-edited: `versions:check` requires it to equal narduk-shell's live
`package.json` version, and `versions:sync` re-pins it when `release:version`
runs.
