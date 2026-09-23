---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app doctor` warns when a worker whose `main` is Nitro's `.output/server`
lacks `no_bundle`, `find_additional_modules` or `base_dir`. Without them,
wrangler re-bundles the build and every server-rendered 404/500 comes out empty
(#245).
`deploy versions-promote --wait-for-version <seconds> [--wait-interval <seconds>]`
re-lists while the commit's version is absent, so a Workers Build that finishes
after CI no longer turns an unbroken merge into exit 3 (#695). The default is 0,
which keeps today's single look.
