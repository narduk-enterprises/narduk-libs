---
'@narduk-enterprises/eslint-config': minor
'@narduk-enterprises/create-narduk-app': patch
---

`import-x/no-cycle`, `import-x/named`, `import-x/default` and `import-x/export` now check local TypeScript code (#973). The pinned import-x resolver used to resolve `./b.ts` but not `./b` or `./b.js` from a `.ts` file, which is how TypeScript sources spell local imports, so these four rules never followed a local import. It now resolves TypeScript extensions and the `.js` → `.ts` alias, and `import-x/extensions` lets the export map parse the resolved `.ts` file.

The four rules move from `error` to `warn`, so the bump turns no consumer red. New findings land in `lint-budget.json` and ratchet down from there, and making the rules `error` again is a follow-up. A strict budget needs `narduk-lint --accept-new-rules` once to record the new counts. `.vue` files are resolved but not parsed for exports. On narduk-core, lint heap and time are unchanged: about 2.1 GB peak RSS and about 25 s both before and after.
