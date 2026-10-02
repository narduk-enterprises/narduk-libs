---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-mapkit': minor
---

Colour a national river network from columnar `so` / `si` / `ri` and a class table, paint in colour-width batches with stream-order then severity and an optional casing, and restyle through the registry's swap-when-drawn path so the overlay never blanks (narduk-libs#1345 L7/L3/L2). The existing per-feature style function keeps working. Reserved class bytes 254 (gauge not reporting) and 255 (no gauge, neutral water) stay distinct from unknown, and a table whose version or length does not match the tiles paints unknown rather than a wrong colour.
