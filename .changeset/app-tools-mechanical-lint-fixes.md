---
"@narduk-enterprises/narduk-app-tools": patch
---

Clear the two mechanical `@typescript-eslint/array-type` narduk-lint warnings
in `tests/foundation/npm-registry.test.ts` (narduk-libs#1237): `{ headers:
Record<string, string> }[]` to `Array<{ headers: Record<string, string> }>`.
Type-only change, no behaviour affected.
