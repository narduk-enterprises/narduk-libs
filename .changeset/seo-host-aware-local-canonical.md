---
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/create-narduk-app': patch
---

`hostAwareIndexing` no longer noindexes the production host when `runtimeConfig.public.siteUrl` fell back to a local origin such as `http://localhost:3000` (a Workers Builds `main` build does not export `SITE_URL`). A loopback, `localhost`, `*.localhost` or `*.test` canonical host is now treated like one that does not normalize: the runtime guard and `canonicalRobotsPolicy` fail open, and the build logs a warning naming `runtimeConfig.public.siteUrl` (#1480). New export: `isLocalIndexingHost` from `@narduk-enterprises/narduk-seo/shared/hostAwareIndexing`.
