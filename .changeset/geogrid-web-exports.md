---
'@narduk-enterprises/geogrid-web': patch
---

The package entry now exports the seven overlay-referenced stretch types (`GridRangeStretch`, `GridDisplayRangeListener` and friends) once, from `core`, instead of through both the `core` and `overlay` barrels; every name importable before is still importable from the same specifier.
