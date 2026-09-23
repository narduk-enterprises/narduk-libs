---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

The shared imports block now sets `import-x/resolver-next` to
eslint-plugin-import-x's own Node resolver (narduk-libs#562). With no resolver
set, import-x fell back to its legacy `node` probe, which crashed
`import-x/no-cycle` on a `vitest.config.ts` with "node with invalid interface
loaded as resolver". An app that turned `import-x/no-cycle` off for its
`vitest.config.ts` can drop that override. narduk-core and narduk-auth have
dropped theirs.
