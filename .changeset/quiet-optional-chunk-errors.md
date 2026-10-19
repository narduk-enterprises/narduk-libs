---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Keep automatic stale-chunk recovery scoped to failed route navigation. Optional async component preload errors now reach their local error boundaries without forcing a document reload; route failures retain the destination and reload loop guard.
