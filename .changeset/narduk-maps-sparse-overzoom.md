---
'@narduk-enterprises/narduk-maps': minor
'@narduk-enterprises/create-narduk-app': patch
---

Geo: sparse static field layers (catalog `sparse: true`). A tile absent at its zoom, because no archive covers it or its archive has no such tile, now shows its nearest ancestor instead of nothing. A fused depth product can then keep 10 m tiles only on the banks and let the 450 m base show through everywhere else. Layers without the flag behave as before.

create-narduk-app: new apps pin the narduk-maps release with sparse layers.
