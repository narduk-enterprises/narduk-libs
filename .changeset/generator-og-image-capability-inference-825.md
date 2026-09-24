---
'@narduk-enterprises/create-narduk-app': patch
---

`upgrade` no longer reads an app as an `seo` app just because it depends on `nuxt-og-image` (narduk-libs#825). Since narduk-seo made `nuxt-og-image` an optional peer (#809), generated SEO apps pin `nuxt-og-image@6.8.0` beside `@narduk-enterprises/narduk-seo`, so the default `useSeo()` path still emits `/_og/` cards and the #316 packed-consumer proofs keep their `/_og/` assertions. That put a third-party package in the `seo` capability's package list. When an app has no `narduk.capabilities` block, `upgrade` works out its capabilities from its dependencies, and any match in that list counted, so an app with `nuxt-og-image` and no `narduk-seo` was read as `seo`. Now only `@narduk-enterprises/*` packages identify a capability.
