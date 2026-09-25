---
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/create-narduk-app': patch
---

`NeDetailView` decides "unavailable" from the value, not by comparing the
rendered text with the placeholder (narduk-libs#875). A reported `'N/A'`, or a
reported `'—'` against the default placeholder, now renders as a reported
value instead of being muted and stamped `data-ne-detail-unavailable`. A
present value that its `format` cannot render (a quantity with no unit, money
with no currency, a date with no zone, a non-number under a numeric format) is
still unavailable. `create-narduk-app` is a companion patch because it pins
narduk-shell.
