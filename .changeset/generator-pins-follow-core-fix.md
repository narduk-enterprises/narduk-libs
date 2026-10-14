---
'@narduk-enterprises/create-narduk-app': patch
---

The generator's package pins follow the pending `narduk-core` patch (`useAppFetch` typechecks on Nuxt 4.6, #1859) and the `narduk-ai` and `narduk-auth` patches that depend on it. The release guard (`release-plan:check`) requires a generator release whenever a pinned package releases; #1859 landed after the last release PR was built, so main went red until this changeset existed.
