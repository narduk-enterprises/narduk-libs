---
'@narduk-enterprises/create-narduk-app': patch
---

Generated auth-capable apps now carry `pnpm.peerDependencyRules.allowAny` for
`@simplewebauthn/browser` and `@simplewebauthn/server`.

narduk-core depends on `nuxt-auth-utils`, whose **optional** passkey helpers
still declare `@simplewebauthn/*@^11` — a range upstream has not moved
since 2024. narduk-auth implements WebAuthn itself against its own exact-pinned
v13 and never calls those helpers, so the two versions never meet at runtime.
Without this rule, every auth-capable app's first `pnpm install` reports an
unmet peer for a feature it does not use.

This also releases the generator alongside the narduk-auth minor so its pinned
`@narduk-enterprises/narduk-auth` version moves with it
(`scripts/check-generator-release-plan.mjs`).
