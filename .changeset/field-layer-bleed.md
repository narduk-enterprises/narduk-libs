---
'@narduk-enterprises/narduk-maps': minor
---

`FieldLayer` takes `bleed: true` to carry a field or image about a texel and a half past its own edge (the mean of the nearest texel's neighbours that have data). A map that draws land over the layer from the same coastline as its base, such as earth-web's land mask, then shows the layer meeting the shore instead of stopping a step short of it. Off by default: without a land mask the extra texel paints over land.
