---
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-seo no longer hard-depends on nuxt-og-image. The package is an optional peer at 6.8.0. Static-card apps omit it and set `ogImage.enabled: false`. Runtime OG or build-time prerender cards (`ogImage.zeroRuntime: true`) add `nuxt-og-image@6.8.0` themselves -- `zeroRuntime` still installs the module and only disables the request-time renderer. If the peer is missing, the layer skips `installModule`, registers a no-op `defineOgImage`, and `useSeo` falls back to the static image. A missing peer is a silent skip on the default/static path; the layer warns only when the app set `ogImage.enabled: true`.

The three image-size highs that originally filed narduk-libs#170 are already gone at nuxt-og-image 6.8.0 (`image-size` is not in the lockfile). This change is the coupling half.

On npm.pkg.github.com / npm.nard.uk the abbreviated packument drops `peerDependenciesMeta`, so an optional peer can still install as required (package-delivery#7). The module skip is what keeps a consumer that does not have the package able to build. Whether the install tree is actually free of nuxt-og-image depends on the registry's packument until the npmjs.org move.
