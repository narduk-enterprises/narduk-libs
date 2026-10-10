---
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

Keep both analytics type-preparation hooks type-safe when a Nuxt consumer compiles the published module without Nitro's optional hook augmentation. Preserve the real Nitro event and its type-reference registration instead of requiring an app-local hook cast.
