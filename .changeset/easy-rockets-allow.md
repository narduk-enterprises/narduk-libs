---
---

Test-only: stop narduk-postgres, narduk-timeseries and narduk-realtime's
package-exports tests from pinning their own manifest's major version, and add a
repo-wide regression guard (`scripts/package-version-assertions.test.mjs`)
against reintroducing it. No `src/`, `dist/`, or runtime behavior changed, so no
package release is needed (narduk-libs#291, #297).
