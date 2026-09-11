---
'@narduk-enterprises/create-narduk-app': minor
---

Generated apps collapse every workspace-published estate pin, and run
`foundation:check:shared-ui-pinned` (narduk-libs#282 review).

- **`pnpm.overrides` regains `@narduk-enterprises/narduk-core` and gains
  `narduk-logging` (always) and `narduk-mapkit` (mapkit capability).** pnpm
  replaces a `workspace:` specifier with the _exact_ version of that workspace
  package at publish time, so a published estate module carries a hard pin on
  whatever its sibling's version was that day. Four generator-pinned modules
  ship `narduk-core: workspace:*` (`narduk-ai`, `narduk-analytics`,
  `narduk-auth`, `narduk-seo`); `narduk-core` ships
  `narduk-logging: workspace:*`; `narduk-mapkit-nuxt` ships
  `narduk-mapkit: workspace:*`. Without the override, the first release that
  moves the app's direct pin and not the publishing module's — the ordinary case
  — installs two copies, which for a Nuxt module is two registrations and two
  `useRuntimeConfig` namespaces. The accepted cost is that Dependabot does not
  update `pnpm.overrides`, so a grouped bump resolves back to the override until
  it is bumped by hand: a stale single copy is recoverable, two live copies are
  not. `@narduk-enterprises/narduk-auth` stays dropped — nothing in the estate
  depends on it, so its override was inert. A new test derives the required set
  from the live workspace manifests, so a new `workspace:` dependency cannot
  reopen the hole silently.
- **New scripts `foundation:shared-ui-pinned` (root and `apps/web`), wired into
  `quality:static`.** The command reads manifests only and needs no registry
  credential, so it runs where the generated install step has already dropped
  the GitHub Packages token. narduk-libs' own `packed-consumer-smoke` job
  expands the generated `quality` chain, so the check also runs against a
  really-installed generated app on every narduk-libs PR.
