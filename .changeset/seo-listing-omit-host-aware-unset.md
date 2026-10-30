---
'@narduk-enterprises/narduk-seo': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-seo adds an `omit(item, index)` option to `sitemapUrlsFromListing` that drops retired, draft or noindex entities before any builder runs; without it nothing changes.

Behavior change for apps that set `hostAwareIndexing`: a build whose deployment target cannot be detected (no `NARDUK_DEPLOY_TARGET`, no `WORKERS_CI_BRANCH` or `CF_PAGES_BRANCH`, as in a deploy-upload build or a CI `build:ci`) now turns the guard on, so a non-canonical host such as a `workers.dev` alias gets `noindex, nofollow` where it used to get `index, follow`. It was off for that build only. The guard noindexes only a request host that differs from the canonical site host, and fails open when `siteUrl` is missing or local, so the canonical host stays indexable as long as `siteUrl` is the production origin. Apps that do not set `hostAwareIndexing` are unaffected. On an undetectable target a request host of `localhost` counts as non-canonical when `siteUrl` is a real origin, so `nuxt dev`, a local `build` and `preview`, and `build:ci` e2e runs of an opted-in app now serve `noindex` on every page, and an e2e test that asserts `index` there will flip. Generated apps are not affected: their `nuxt.config.ts` write-back always sets the target and they do not set `hostAwareIndexing`. To opt out, leave `hostAwareIndexing` off. The localhost `siteUrl` warning still prints for an explicit `production` target only. Found by borderwaitstat-us#218.
