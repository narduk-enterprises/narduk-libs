---
'@narduk-enterprises/create-narduk-app': patch
---

`upgrade` creates a missing `manifests:validate` script but no longer rewrites
one an app has already given a body, so an app whose own proofs run under that
name keeps them (#468).
