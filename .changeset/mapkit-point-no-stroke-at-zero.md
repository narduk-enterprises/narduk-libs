---
'@narduk-enterprises/narduk-mapkit': patch
---

The canvas point layer no longer strokes a dot whose style has `strokeWidth: 0`. A canvas ignores
`lineWidth = 0` and strokes with the width it had before, so a style that asked for no outline got the
previous dot's outline in its `stroke` colour: a halo round every flat dot (River Status gauges at state
zoom). A dot with a stroke width of 0 is now only filled.
