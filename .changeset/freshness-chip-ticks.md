---
'@narduk-enterprises/narduk-ui': patch
---

`NsFreshnessChip` without `now` re-reads its clock every 30 seconds after
mount instead of once, so a stalled producer moves from LIVE to AGING to STALE
while the page is open rather than showing LIVE with a frozen age forever. The
timer is cleared on unmount and never runs while a `now` is injected
(narduk-libs#936).
