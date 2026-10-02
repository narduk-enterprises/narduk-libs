---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-mapkit': minor
---

Selection highlight and one hit resolver (narduk-libs#1345 L10/L11).
`resolveHit` asks a point layer, the vector-tile overlay's `hitTest` and a
caller-supplied area tester in the order given and returns one result typed
`point`, `line` or `area`, or `null`; a layer after a hit is not asked. The
tolerance is `DEFAULT_MOUSE_HIT_TOLERANCE_PX` (8, today's default; also used for
a pen) or `DEFAULT_TOUCH_HIT_TOLERANCE_PX` (22, half the 44-point touch target),
each overridable. The overlay source gains `setHighlight` / `clearHighlight` /
`highlightImageForTile` / `setHighlightHost`: every cached piece whose `si`
equals the highlighted id is drawn on its own overlay in the caller's style,
from the decoded cache only, without re-reading, re-decoding or repainting the
base tiles; a tile that arrives later shows it, an overzoomed tile highlights
from its ancestor, and `VECTOR_TILE_MISSING_ID` never matches. Everything new is
optional.
