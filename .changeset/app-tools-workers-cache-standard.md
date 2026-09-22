---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Foundation check 12.7 now needs narduk-core **2.10.0** or later before an app
turns on Workers Cache, up from 2.2.4. Cores from 2.2.4 to 2.9.x still let
Cloudflare store a thrown JSON 404 as Nitro's `no-cache` (narduk-libs#493). An
app with the switch on and an older core now fails 12.7; upgrade narduk-core or
remove the `cache` block.

New `docs/workers-cache.md`: the standard for turning Workers Cache on in an
existing app (narduk-libs#435), with its preconditions, the wrangler change, the
`verify --live --edge-cache-path` proof, purging and rollback.
