---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`foundation:check` sub-check 5.1 is now named "class callable pinned @v1 or a 40-char SHA", and its `unknown` detail no longer cites the retired company-hq `Config/workflow-adoption-matrix.json`; a hand-rolled-CI exemption is a `foundation_exception` in company-hq's registry, which an app's own CI still cannot read, so the verdict stays `unknown`.
