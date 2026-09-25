---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

`declutter()` (`./marks`) now sizes its merge grid from the largest item radius, so overlapping discs with a radius above 24 px merge wherever they sit on screen instead of depending on grid position (#933).
