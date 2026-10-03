---
'@narduk-enterprises/narduk-mapkit': minor
---

National-zoom vector tiles draw crisp on 2x and 3x screens.

- `createMvtDecoder` / `decodeMvtTile` smooth the staircase a coarse tile grid
  leaves in a network. A layer whose extent is under 4096 (river-network v3
  builds z0-3 on 512 and z4 on 256, every line a two-point unit step) is
  lifted onto a 4096 grid and every point joined to exactly two others moves
  halfway towards their average, twice (`smoothCoarseNetwork`, exported).
  Junctions, ends and crossings stay exactly where the tile put them, and no
  point moves more than about one grid unit. A 4096-extent layer decodes
  exactly as before.
- `paintVectorTile` no longer widens a hairline to half a CSS pixel. A stroke
  asked for under one device pixel is drawn one device pixel wide at
  proportionally lower opacity (`hairlineStroke`, exported), so a 0.3 CSS px
  line on a 3x screen is 1 device px, not 1.5. Lines of a device pixel or
  more are unchanged. Highlight strokes are unchanged.
