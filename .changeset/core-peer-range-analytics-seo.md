---
'@narduk-enterprises/narduk-analytics': minor
'@narduk-enterprises/narduk-seo': minor
'@narduk-enterprises/create-narduk-app': patch
---

Declare `narduk-core` as a peer range instead of an exact-pinned dependency.

Both packages carried `@narduk-enterprises/narduk-core` as `workspace:*` in
`dependencies`, which publishes as an exact pin. An app upgrading narduk-core
therefore kept a second, older copy alive underneath these two — and narduk-core
is a Nuxt module that appends global CSS to `nuxt.options.css`, so which copy's
stylesheet wins comes down to module resolution order rather than anything the
app declares.

`narduk-core` now sits in `peerDependencies` at `>=2.6.3 <3.0.0` with a
`workspace:*` `devDependencies` entry for these packages' own builds and tests,
matching `narduk-uploads`. The consuming app owns the single resolved version.

Released as a minor rather than a patch because it changes the published
manifest shape: an app that reached narduk-core only transitively through these
packages must now resolve it itself. Every generated app already declares
narduk-core directly — it is the first entry in the generator's Nuxt `modules`
list — and pnpm and npm both auto-install a missing peer, so no estate app is
expected to need a change.
