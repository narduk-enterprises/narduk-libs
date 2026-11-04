---
'@narduk-enterprises/narduk-maps': minor
---

`FieldLayer` takes `relief` to shade a field from its own slopes: a hillshade (light from the north-west, 45° up) overlaid on its colour the way My Boat's chart shades its depth colours. `relief: { log10: true }` for a log10 depth field shades `log10(1 + depth / 5 m)`, so banks read as strongly as walls without a bay's foot of change turning into a cliff. Slopes are central differences one source texel each way, one-sided at a tile's edge so tile edges never draw as lines. Off by default.
