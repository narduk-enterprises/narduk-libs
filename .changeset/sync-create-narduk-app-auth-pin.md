---
'@narduk-enterprises/create-narduk-app': patch
---

Release alongside the `narduk-app` minor bump (the new HTTP error + requestBody
contract). `@narduk-enterprises/narduk-auth` depends on
`@narduk-enterprises/narduk-app` via `workspace:*`, so Changesets'
`updateInternalDependencies: "patch"` policy cascades a patch release to
narduk-auth — which is itself a generator-owned pinned package
(`create-narduk-app`'s `PACKAGE_VERSIONS`). This keeps the generator's pin in
sync with that cascaded release. No behavior change in the generator itself.
