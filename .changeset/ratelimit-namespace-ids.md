---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app doctor` checks Cloudflare rate-limit namespace ids (#433). A
`ratelimits` binding, top level or under `env.*`, fails if it uses a scaffold id
(`1001`, `50110`, `50121`, `50300`), if its id is declared more than once, or if
it has no `namespace_id`. `namespace_id` is unique per account, so any of those
shares counters with another Worker or environment. An app with its own unique
ids passes.

`create-narduk-app` writes the new app's own namespace prefix into
`wrangler.jsonc`, derived from the Worker name by narduk-core's scheme, beside a
commented example binding. It still emits no binding, because the limiter needs
none.
