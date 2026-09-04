---
'@narduk-enterprises/narduk-auth': patch
---

Set explicit `autocomplete` tokens on `AuthLoginCard` and `AuthRegisterCard`
credential fields (`email`, `current-password`, `new-password`, `name`).
`@nuxt/ui@4.6.0`'s `Input.vue` defaults `autocomplete` to `"off"` when a
consumer doesn't override it, which blocked password managers from filling or
saving credentials on every app using these cards (narduk-libs#60).
