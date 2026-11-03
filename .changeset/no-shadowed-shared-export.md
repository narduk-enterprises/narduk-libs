---
'@narduk-enterprises/eslint-config': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `narduk/no-shadowed-shared-export`, on as `warn` in the `design-system` pack. It flags a top-level function, const or class an app declares under the name a released `@narduk-enterprises/*` package already exports (`median`, `plural`, `slugify`, `formatNumber`, `sha256Hex`). A `// LIBS-KEEP: <name> <reason>` comment, the `allow` option or an `eslint-disable` marks a copy kept on purpose. The name list is generated from the packages' `exports` maps by `scripts/generate-shared-exports.mjs` (narduk-libs#2126).
