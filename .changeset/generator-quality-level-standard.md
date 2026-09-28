---
'@narduk-enterprises/create-narduk-app': minor
---

New private apps run the shared workflow's `quality-level: standard` (narduk-enterprises/workflows#158), and a fresh scaffold passes all three of its gates. Minor, not patch: new apps get new CI gates, two new devDependencies and a different `nuxt.config.ts`, and the package exports a new `ciQualityLevel` option.

- **Workflow pin.** `nuxt-cloudflare.yml` moves from `1513b2a` to `59825ef`, the first commit that declares `quality-level`. `upgrade` moves an older pin forward as before. It never adds `quality-level`, so an existing app does not get the gates from a pin bump.
- **CI caller.** The private `ci.yml` passes `quality-level: standard` and `performance-budget-args: '--app-dir apps/web --font-total-budget-kb 140'`. The budget runs from the repository root, so it has to be pointed at the workspace app, with the same budget the app's own script uses. `preview-checks` stays at `og`, which the security-headers probe needs.
- **Enforced CSP.** `nardukCore.security.headers: { enabled: true, enforce: true }`, with the `nuxt-security@2.6.0` peer. The seo scaffold no longer prerenders `/`. A prerendered page is a static asset served with no Content-Security-Policy, so the probe failed on the home page of a fresh seo app.
- **Font budget.** `fonts.defaults.subsets: ['latin']` now applies to every scaffold, not only seo. The default Google Fonts subsets of Inter and Outfit came to 211.6 KiB, over the 140 KiB font total.
- **Accessibility.** The home e2e spec calls narduk-testkit `expectAccessible` (with the `@axe-core/playwright@4.13.0` peer), and the non-seo `nuxt.config.ts` sets `htmlAttrs.lang`. A fresh app failed axe's `html-has-lang` without it.
- **Quality bar.** When the app's `ci.yml` passes `quality-level: standard`, the AGENTS.md CSP, accessibility and performance lines state those gates, and a new line says CI runs the standard level and that an opt-out needs a written reason in `quality-opt-out`. Otherwise those lines stay adoption steps. `upgrade` reads the level from the app's own `ci.yml`, so a refreshed block does not claim a gate that app's CI does not run. A public app, which does not call the shared workflow, keeps the adoption wording.
