---
'@narduk-enterprises/create-narduk-app': minor
---

Scaffold a `.github/dependabot.yml` with one Dependabot group (`narduk-libs`,
patterns `@narduk-enterprises/*`) using `directories: ['/', '/apps/*']` so the
update covers the root lockfile and the `apps/web` manifest that holds the
estate pins (components-library-plan.md §2 item 6, narduk-libs#253). Generated
apps now carry one bot config: `renovate.json` is no longer scaffolded
(D-TOOLCHAIN-1 prefers Dependabot; item 5.2 already accepts either). Estate
packages (`narduk-core`, `narduk-auth`) are dropped from `pnpm.overrides`
because they are already exact-pinned as direct deps and Dependabot does not
update that field -- an override would resolve a grouped bump straight back to
the old version. `@nuxt/kit` stays in overrides (modules depend on a range).
The registries block reads the org-level Dependabot secret
`NARDUK_PLATFORM_GH_PACKAGES_READ`. A live Dependabot run against a generated
app is not possible from the PR VM; empirical proof is a follow-up.
