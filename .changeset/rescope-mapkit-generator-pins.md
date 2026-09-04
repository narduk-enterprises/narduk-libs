---
'@narduk-enterprises/create-narduk-app': minor
---

create-narduk-app: fix the `mapkit` capability to scaffold the live
`@narduk-enterprises/narduk-mapkit` / `@narduk-enterprises/narduk-mapkit-nuxt`
packages at `2.0.0` instead of the dead `@narduk-geo/narduk-mapkit*` scope
pinned at `1.0.0` (narduk-libs#123). The `@narduk-geo` scope has not published
since 1.1.1 and cannot publish again (narduk-mapkit#17); narduk-mapkit
republished under `@narduk-enterprises` at `2.0.0` on 2026-08-28. A freshly
scaffolded mapkit app previously installed a frozen, unpatchable dependency
from a scope that no longer resolves for new consumers.

The generated `.npmrc` now routes only `@narduk-enterprises/*` to GitHub
Packages — the `@narduk-geo:registry=...` line is dropped, since every scoped
package a generated app depends on now lives under `@narduk-enterprises`. The
generated README note and the generated Renovate `matchPackageNames` group are
updated to match.
