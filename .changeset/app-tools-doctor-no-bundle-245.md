---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app doctor` warns when a worker whose `main` is Nitro's `.output/server` lacks `no_bundle`, `find_additional_modules` or `base_dir`. Without them, wrangler re-bundles the build and server-rendered 404/500 pages come out empty (narduk-libs#245).
