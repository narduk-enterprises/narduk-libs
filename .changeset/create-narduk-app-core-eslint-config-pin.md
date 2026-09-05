---
'@narduk-enterprises/create-narduk-app': patch
---

Companion release for the narduk-core patch that moves
`@narduk-enterprises/eslint-config` from a runtime dependency to an optional
peerDependency (narduk-libs#154). No generator behavior change; this bumps the
generator alongside its pinned `@narduk-enterprises/narduk-core` version per
`scripts/check-generator-release-plan.mjs`.
