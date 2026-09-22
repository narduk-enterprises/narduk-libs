---
'@narduk-enterprises/narduk-testkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-testkit/d1`: `createD1QueryHarness` now runs on Miniflare 5, which every
Wrangler from 4.129 ships. It converts its options with Miniflare's own
`convertV4MiniflareOptions` when that exists and passes them unchanged to
Miniflare 4.

`create-narduk-app`: generated apps pin `wrangler` 4.136.3 and
`@cloudflare/workers-types` 5.20260922.1. The older Wrangler's Miniflare brought
`sharp` and `undici` versions with high advisories.
