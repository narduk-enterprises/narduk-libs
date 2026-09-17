---
'@narduk-enterprises/narduk-ui': patch
---

Stop `NsFreshnessChip` from reading the ambient clock during SSR. Without `now`,
the preferred `observedAt` path renders a stable placeholder until mount.
