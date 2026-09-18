---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`foundation:check` now reads the registry for sub-check 2.3 from the project's
own `@narduk-enterprises` scope route (narduk-libs#498). The reader takes the
last `@narduk-enterprises:registry=` line in the checkout's `.npmrc`, the same
rule as the shared CI workflows. A repo that routes the scope to the
`https://npm.nard.uk` mirror, or to any other registry that is not GitHub
Packages, is read anonymously. The reader sends no `Authorization` header there,
so it needs no `NODE_AUTH_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN`. Repos with no route
line, or a route to `npm.pkg.github.com`, keep the existing GitHub Packages
Bearer read and its scope-probe 404 corroboration. Other scopes such as
`@narduk-geo` stay on GitHub Packages.

`create-narduk-app` takes a patch so generated apps pin the fixed
`narduk-app-tools`.
