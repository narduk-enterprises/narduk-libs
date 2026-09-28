---
"@narduk-enterprises/narduk-core": patch
---

Clear the mechanical `sonarjs/no-duplicate-string` narduk-lint warning in
`tests/security-headers-preset.test.ts` (narduk-libs#1237) by extracting the
repeated `'script-src'` literal into a `SCRIPT_SRC` const. Test-only change,
no runtime behaviour affected.
