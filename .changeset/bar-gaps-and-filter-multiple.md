---
'@narduk-enterprises/narduk-charts': minor
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
---

NardukBarChart can draw a missing value as a gap (#1544), and NeFilterBar can press more than one control (#1545). Both are opt-in; the defaults are unchanged.

`NardukBarChart` takes `missingValues="gap"` (and `missingLabel`, default `no value`): a `null`, `undefined` or `NaN` datum draws as a short hatched stub (`narduk-bar-rect--missing`, `data-nc-state="missing"`) and a real `0` draws a 1px floor bar, so the two can never be read as each other. The tooltip, each bar's accessible name and the data table say `missingLabel` instead of a number, the default chart name counts the gaps, and a missing slot does not emit `barClick`. With `missingValues="zero"` (the default) a missing value still draws as a zero-height bar.

`NeFilterBar` takes `multiple`: `modelValue` is then the array of pressed keys, each pressed control carries `aria-pressed="true"` and `ui.selected`, and a click still emits only the clicked key for the caller to toggle. `kind="tabs"` ignores `multiple` (a tablist has one selected tab). Without `multiple`, `modelValue` is the single key as before.
