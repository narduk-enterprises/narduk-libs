---
'@narduk-enterprises/narduk-app': minor
'@narduk-enterprises/create-narduk-app': patch
---

Nonce-based `script-src` without `'unsafe-inline'`. New
`@narduk-enterprises/narduk-app/server/csp-nonce`: `getCspNonce(event)` mints a
per-request nonce and `installCspNonce(nitroApp)` stamps it on every `<script>`
of a Nuxt-rendered page (the inline hydration payload and import map included)
and makes that HTML `private, no-store`. `buildSecurityHeaders` /
`applySecurityHeaders` take an optional `nonce`, added to `script-src` of both
CSPs with `'unsafe-inline'` dropped there. Opt-in: without a nonce nothing
changes. `pnpm prove:nonce` proves it against a real Nuxt build.
