---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-mapkit': minor
---

Add a canvas point layer for the national gauge map (narduk-libs#1345 L1): paint dots into tile images from columnar typed arrays, restyle a class column from memory without re-projecting, and answer `nearestPoint` for a tap. Reserved class bytes keep no-data and not-reporting visually distinct from each other and from the lowest real class; nothing defaults to zero.
