---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Preserve D1 bindings across Nitro internal SSR fetches so a nested
`useFetch` keeps the outer Worker `DB` (narduk-libs#49).
`create-narduk-app` is a companion patch so the generator pin moves with
core.
