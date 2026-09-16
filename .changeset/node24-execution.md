---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/eslint-config': patch
---

Run generated app CI on Node 24.21.0 and emit matching `.nvmrc`, `engines.node`
and Volta declarations from one constant. This matches the Node 24 minimum the
shared ESLint configuration already requires. Correct that package's stale Node
22 documentation. The repository's own CI, release jobs and root runtime pin
also move to Node 24.21.0; package JavaScript output targets retain their
existing compatibility range.
