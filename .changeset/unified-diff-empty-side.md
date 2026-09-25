---
'@narduk-enterprises/create-narduk-app': patch
---

`upgrade`'s dry-run diff renders a created managed file as additions only
(`@@ -0,0 +1,N @@`) and an emptied one as removals only, instead of showing a
phantom blank line on the empty side.
