---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`foundation:check` item 2.3 now reads GitHub Packages with `GH_PACKAGES_READ` ahead of `GH_TOKEN` and `GITHUB_TOKEN` (narduk-libs#1196). The #698 fix put it last, so any shell that also exported a general-purpose GitHub token, such as an agent lane's repository-scoped `GH_TOKEN`, sent that token instead, could not see the package, and item 2.3 went `unknown` under `gh-packages-run`. The order is now `NODE_AUTH_TOKEN`, `GH_PACKAGES_READ`, `GH_TOKEN`, `GITHUB_TOKEN`, and an exported-but-empty name counts as unset. CI, which exports `NODE_AUTH_TOKEN`, resolves the same credential as before.
