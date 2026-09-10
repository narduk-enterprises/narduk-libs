---
'@narduk-enterprises/narduk-app-tools': patch
---

`foundation:check` item 5.2 now also accepts `.github/dependabot.yml` as
satisfying the "@narduk-enterprises scope addressed" requirement, alongside the
existing `renovate.json` / `.github/renovate.json` check (narduk-libs#233,
company-hq D-TOOLCHAIN-1). A `groups.*.patterns` entry matching the scope
(grouping) or an `ignore[].dependency-name` entry matching it (delegation, the
Dependabot-native equivalent of Renovate's `packageRules[].enabled: false`) both
pass, mirroring borderwaitstat-us PR #19's `ignore` block. Dependabot is the
documented preferred form going forward; `renovate.json` still passes on its own
since not every repo has migrated yet. Consumers do not need to keep a
`renovate.json` around once they adopt `.github/dependabot.yml` with either
shape — bump to this version to delete it without failing item 5.2.
