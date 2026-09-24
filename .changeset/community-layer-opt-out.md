---
'@narduk-enterprises/eslint-config': minor
'@narduk-enterprises/create-narduk-app': patch
---

`composeSharedConfigs()` and `createAppLintConfig()` accept `communityLayer: false` so a caller can take a capability pack without the shared community tail (`import-x`, `unicorn`, `promise`, `security`, `regexp`, `eslint-comments`, `vitest`, Vue house style). Today's default stays on for every existing caller (narduk-libs#167).
