---
'@narduk-enterprises/narduk-seo': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-seo adds an `omit(item, index)` option to `sitemapUrlsFromListing` that drops retired, draft or noindex entities before any builder runs; without it nothing changes.

Behavior change for apps that set `hostAwareIndexing`: a build whose deployment target cannot be detected (no `NARDUK_DEPLOY_TARGET`, no `WORKERS_CI_BRANCH` or `CF_PAGES_BRANCH`, as in a deploy-upload build or a CI `build:ci`) now turns the guard on, so a non-canonical host such as a `workers.dev` alias gets `noindex, nofollow` where it used to get `index, follow`. It was off for that build only. The guard noindexes only a request host that differs from the canonical site host, and fails open when `siteUrl` is missing or local, so the canonical host stays indexable as long as `siteUrl` is the production origin. Apps that do not set `hostAwareIndexing` are unaffected. To keep the guard off for one build, set `NARDUK_DEPLOY_TARGET` to `staging` or `preview`. The localhost `siteUrl` warning still prints for an explicit `production` target only. Found by borderwaitstat-us#218.
