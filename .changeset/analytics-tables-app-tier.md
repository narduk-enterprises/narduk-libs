---
'@narduk-enterprises/narduk-analytics': patch
---

narduk-analytics turns `narduk/prefer-shared-collection` off for its admin
panels (narduk-libs#744). The rule is app-tier, and a module sits below
narduk-shell, so the panels keep plain `<UTable>`s. Only the package's lint
configuration changed; the published output is the same.
