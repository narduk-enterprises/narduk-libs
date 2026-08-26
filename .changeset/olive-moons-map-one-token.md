---
'@narduk-enterprises/create-narduk-app': patch
---

Generate one packages-read credential name instead of three. The generated CI no
longer sets a redundant `NODE_AUTH_TOKEN` alias, and no longer gives
`actions/setup-node` the `registry-url`/`scope` inputs that made it write a
competing userconfig `.npmrc` against that alias with `always-auth=true`. The
committed `.npmrc` already routes both scopes and reads `GH_PACKAGES_READ`, so
CI now maps the org secret into that single name. The generated README states
both halves of the pair.
