---
'@narduk-enterprises/narduk-core': patch
---

Fix two small bugs from the W2 hardening batch (narduk-libs#124):

- `useAppFetch()` threw `useRequestFetch is not defined` when called from a
  consuming app, because it relied on a Nuxt auto-import that never resolves
  from `node_modules`. It now imports `useRequestFetch` explicitly from
  `#imports`, matching the pattern every other composable in this package
  already uses (narduk-libs#59).
- Removed the orphaned `showcaseAuthLoginTest` rate-limit policy. Its only
  consumer, `useAuthApi().loginAsTestUser()`, was removed from narduk-auth in an
  earlier correctness pass, and the `/api/auth/login-test` endpoint it guarded
  has never existed in this repo (narduk-libs#96).
