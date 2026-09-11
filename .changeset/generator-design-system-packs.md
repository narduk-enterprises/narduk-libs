---
'@narduk-enterprises/create-narduk-app': minor
---

Generator: lint packs and narduk-shell by default (components-library-plan.md §2
item 4, narduk-libs#251).

- Adds the `design-system` and `nuxt-ui` capability packs to the four already
  hardcoded (`core`, `correctness`, `complexity`, `formatting`) in both
  `apps/web/eslint.config.mjs` (`createAppLintConfig`) and the root
  `eslint.config.mjs` (`composeSharedConfigs`), so every new app starts on the
  Nuxt UI element discipline, the Tailwind v4 token tier, and the three
  legacy-API guardrails from day one.
- `@narduk-enterprises/narduk-shell` joins the default module list
  (`nuxt.config.ts`) and the default runtime `dependencies`, unconditionally and
  not behind a capability flag — the same way narduk-core always ships — with an
  exact pin. The pin is `0.0.0`: narduk-shell has never been published (item 1
  shipped the skeleton without a release, and every wave-2 component item since
  has left its changeset unconsumed), and the pin has to equal the package's
  live on-disk version for `versions:check`, not a preview of its next release.
- Adds a `charts` capability that pins `@narduk-enterprises/narduk-charts`, the
  one existing capability package that is not itself a Nuxt module (no `nuxt`
  peer, no `module.ts`) — it is excluded from the generated `modules: [...]`
  array for that reason, and added to the generated app's `knip.json`
  `ignoreDependencies` because nothing in the scaffold imports from it directly
  yet.
- Extends the narduk-libs `packed-consumer-smoke` fixture
  (`scripts/release-packages.mjs`) so the generated release-smoke app renders
  `<NeStatusBadge>` alongside `LayerAppHeader`, and asserts its label is visible
  in a real browser via Playwright — proof that the packed narduk-shell tarball
  registers and renders a component, not just that `nuxt build` succeeds.
  `@narduk-enterprises/narduk-shell` is added to
  `assertExactGeneratedPackagePins`'s required-package set alongside the other
  always-shipped packages.

No override entry is added to the generated app's `pnpm.overrides` for
narduk-shell: it has no runtime `@narduk-enterprises/*` dependency of its own,
and nothing else in the workspace ships it as a `workspace:` **runtime**
dependency today (`design-system-build` depends on it only as a devDependency,
which `tests/workspace-override-safety.test.ts` deliberately excludes) — so
there is no second copy an override could collapse.
