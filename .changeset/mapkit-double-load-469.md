---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

`<AppMapKit>` no longer loads `mapkit.core.js` twice (narduk-libs#469). The SSR
preload's `useHead()` now runs during the server render only. Through 2.1.2 it
also ran on the client, where unhead's DOM renderer had to recognise the
server's `<script>` by hashing every attribute on it. Under a nonce CSP
(narduk-core `security.headers`) the browser hides the tag's nonce as
`nonce=""`, the hash never matched, and unhead appended a second copy, which
MapKit reports as `Mapkit namespace already exists`. On the client, Apple's
`@apple/mapkit-loader` is now the tag's only owner: it adopts the server's tag
on an SSR page load and injects the single tag on a client-side navigation.

`@narduk-enterprises/create-narduk-app` only re-releases so its pinned
`@narduk-enterprises/narduk-mapkit` version follows this patch
(`scripts/check-generator-release-plan.mjs`'s generator-pin rule). The
generator's behavior does not change.
