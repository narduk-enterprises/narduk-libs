---
'@narduk-enterprises/narduk-mapkit': minor
---

A vector tile overlay's `hitTest` can choose among the features within reach
instead of taking the nearest.

- `hitTest({ rank })` ranks each candidate from its properties: the highest rank
  wins and, among equal ranks, the nearest. Rank a stream by its order and a
  creek a few pixels from a big river no longer takes the pointer from it.
- `hitTest({ accept })` refuses features before the choice, so a stream the
  current zoom does not draw cannot shadow a drawn one behind it.
- `hitTestTile(tile, x, y, within, select?)` takes the same `accept` and `rank`
  by feature index, and its hit now reports the `rank` it won with.
- With neither option, `hitTest` is unchanged: the nearest feature wins.
