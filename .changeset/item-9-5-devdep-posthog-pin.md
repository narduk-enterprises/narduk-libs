---
'@narduk-enterprises/narduk-app-tools': patch
---

foundation:check item 9.5 no longer warns about a `posthog-js` pin that lives only in `devDependencies` (a test-only use cannot ship an analytics wrapper). A pin in `dependencies`, `optionalDependencies` or `peerDependencies` with no import keeps the heuristic WARN.

foundation:check item 9 (coverage scan) now excludes test, fixture and generated files from the source scan and raises the file ceiling from 2000 to 6000, so a large app (stonx, 2106 files) gets a real verdict for 9.3-9.8 instead of UNKNOWN. A scan that still exceeds the ceiling stays UNKNOWN.
