---
'@narduk-enterprises/eslint-config': patch
---

Run core `no-unused-vars` on `.js`/`.mjs`/`.cjs` and keep `@typescript-eslint/no-unused-vars` on TS and Vue only, so espree-parsed scripts no longer report every binding as "only used as a type" (#1727).
