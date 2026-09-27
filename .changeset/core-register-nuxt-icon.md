---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-core': patch
---

`coreModules` registers `@nuxt/icon` 2.5.1, which narduk-core now depends on, after seeding the local-only icon contract and before `@nuxt/ui`. `@nuxt/ui` 4.11.1 declares the icon module as a dependency Nuxt resolves from the app root, and pnpm does not expose that transitive package, so a consumer that does not list `@nuxt/icon` itself failed the build with `Could not load .nuxt/nuxt-icon-client-bundle`. Apps still do not need to list the module. An app that lists it before narduk-core keeps the existing order warning (narduk-libs#467). The generator release picks up the new narduk-core pin.
