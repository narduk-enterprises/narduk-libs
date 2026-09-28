---
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

Make the analytics runtime-config type boundary work with generated Nuxt
consumer configs that require their own app and Nitro keys. Preserve the same
runtime object and module-default guarantees, and strengthen the consumer
typecheck fixture to reproduce the TS2352 failure seen in Buoys.
