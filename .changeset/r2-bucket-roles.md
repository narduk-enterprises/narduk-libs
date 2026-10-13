---
'@narduk-enterprises/narduk-app-tools': minor
---

`Config/cloudflare-app.json` `bindings.r2[]` entries take an optional `role`:
`uploads` (the default when absent), `read-only-assets`, `archive` or
`app-data`. `narduk-app manifests validate` rejects any other value, and the
vocabulary is exported as `R2_BUCKET_ROLES`.

foundation:check 3.3 ("writes R2: narduk-uploads") now fails only when a bucket
has the role `uploads`, declared or defaulted, and `narduk-uploads` is not a
dependency. When every declared bucket has another role it is `not-applicable`,
and the detail names each binding and role. A `read-only-assets` bucket also
fails 3.3 when a file under `server/` calls `.put(` or `.delete(` on its
binding. An app with no manifest `bindings.r2` entry still falls back to its
wrangler config, which carries no role, so it keeps today's verdict. Closes
narduk-libs#1285.

An app with a non-upload bucket writes, for example,
`{ "binding": "TIMELINES", "bucketName": "music-timelines", "role": "app-data" }`
and bumps `@narduk-enterprises/narduk-app-tools` to this release for the
validator to accept `role`.
