---
'@narduk-enterprises/geogrid-web': patch
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/narduk-maps': patch
'@narduk-enterprises/narduk-mapkit': patch
---

Fix the ponytail-5 map findings: geogrid overview buckets no longer drop pixels inside a real cell and the tile renderer rebuilds its GL objects after a context restore; candle charts keep a controlled domain when a bar is appended, aggregate candles into non-overlapping buckets, scale volume bars to the drawn buckets, and the histogram ignores non-finite samples; narduk-maps drops `javascript:` and other unsafe point hrefs; narduk-mapkit no longer paints a vector tile read that began before `clearCache`, and its Nuxt token example derives the claim origin with `mapKitRoutedOrigin`.
