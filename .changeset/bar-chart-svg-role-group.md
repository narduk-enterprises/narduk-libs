---
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/create-narduk-app': patch
---

`NardukBarChart`: give the plot `<svg>` `role="group"` instead of `role="img"`. The bars are `role="button"` with a roving `tabindex`, so the `img` role hid focusable children and axe reported serious `nested-interactive` (narduk-libs#1781). `aria-labelledby` is unchanged.
