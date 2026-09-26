---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/narduk-ai': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth, narduk-seo, narduk-analytics and narduk-ai now declare `@nuxt/ui`
as a peer at exactly `4.11.1` (#1033). Each package renders Nuxt UI components
and none declared it. This is the version narduk-core already depends on and
narduk-shell already requires as a peer, so an app on narduk-core already
installs it. An app on another `@nuxt/ui` version now gets pnpm's peer warning.
