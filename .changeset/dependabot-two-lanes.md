---
'@narduk-enterprises/create-narduk-app': minor
'@narduk-enterprises/narduk-app-tools': minor
---

`.github/dependabot.yml`'s npm update now splits into two groups by
`update-types` over the same packages: `safe` (minor + patch) and `majors`
(major), `open-pull-requests-limit: 2`. A new generated
`.github/workflows/dependabot-merge.yml` merges the `safe` lane once CI is green
on its exact PR head; `majors` and the `github-actions` lane stay a deliberate
person/agent PR. This replaces the old single all-in `dependencies` group
(gonogo#104, the reference shape): apps on the old canonical shape
(`open-pull-requests-limit: 10`, ~10 groups) stacked roughly ten open PRs that
all edited `pnpm-lock.yaml`, so merging any one conflicted the rest, and a
single combined group let one breaking major hold every harmless patch bump red
behind it (riverstatus#215).

`create-narduk-app upgrade` delivers `.github/workflows/dependabot-merge.yml` to
existing apps as a new whole-file managed target alongside the refreshed
`.github/dependabot.yml`.

`narduk-app-tools`' `foundation:check` gains an advisory-only print (not a
`FoundationSubCheck`, since this framework has no warning tier) that flags a
`.github/dependabot.yml` npm update reproducing the old stacking shape:
`open-pull-requests-limit` above 2, or npm groups not split by `update-types`
into a safe and a majors lane. It never affects the check's `score`, `result`,
or `exitCode`.
