---
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/create-narduk-app': patch
---

`formatCompact` no longer throws a `RangeError` when `minimumFractionDigits` is
above its default ceiling of one digit; the ceiling rises to meet it.
`formatPercent` now honours `minimumFractionDigits` / `maximumFractionDigits`
like the other number formatters instead of dropping them; its one-digit
default applies only when none of `digits` or the pair is given
(narduk-libs#937).
