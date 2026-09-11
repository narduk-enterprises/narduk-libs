---
'@narduk-enterprises/narduk-shell': minor
---

Fill `@narduk-enterprises/narduk-shell/theme.css` with the NE token layer and
bridge it onto Nuxt UI (components-library backlog item 2, narduk-libs#249;
backlog narduk-libs#247; standing decision company-hq D-WEBFOUND-2 and its
2026-09-11 amendment).

- **`theme.css`** now declares 42 `--ne-*` tokens — ground and the four-step
  surface scale, the six-step ink scale, hairline/divider/strong line, the
  `--ne-accent` and `--ne-structure` brand hooks, radius, shadow, the type scale
  and two layout tokens — for light (`:root, .light`) and dark (`.dark`), and
  points Nuxt UI's own `--ui-bg*`, `--ui-text*`, `--ui-border*`, `--ui-radius`,
  `--ui-container` and `--ui-header-height` at them. Every `U*` primitive and
  every future `Ne*` wrapper therefore takes its look from this one sheet. The
  declarations are unlayered, so they beat Nuxt UI's `@layer theme` defaults
  regardless of stylesheet order, and an app's own sheet still wins over them.
  Schemes follow Nuxt UI's class switch rather than a bare media query; a page
  with no colour-mode runtime opts in with `data-ne-scheme="auto"`.
- **`src/app-config.ts`** exports `NARDUK_SHELL_APP_CONFIG`, the Nuxt UI colour
  aliases the suite needs (`primary: 'sky'`, `neutral: 'slate'`). The colour
  aliases are deliberately _not_ bridged in CSS: Nuxt UI expands each into an
  eleven-shade scale that every button variant reads, so brand colour stays
  `app.config`'s job.
- **Module option `nardukShell.theme`** (default `true`) unshifts the sheet onto
  `nuxt.options.css` and merges the preset with `defu`, so anything the app or
  another module already set survives. `false` is the escape hatch.
- **Contrast is a regression test, not a claim.** `test/theme.test.ts` computes
  WCAG 2.2 relative luminance over the shipped values and asserts every body ink
  clears 4.5:1 on every surface in both schemes, reproducing the
  operator-portal#238 pair (`#62748e` on `#edf0f4`, 4.16:1) to prove the helper
  measures something real. It also proves every `--ui-*` bridge target is a
  variable the _installed_ Nuxt UI actually reads, parsed out of the package on
  disk rather than copied into the test.

The NE Base Foundations card in `design-system-build` now shows both schemes
side by side (surfaces, inks, the `accent`/`structure` hooks, radius and type)
and the `text-muted` class that failed in operator-portal#238. The preview
extractor treats `--ne-*` as coded tokens alongside `--ns-*`.

No component is registered by this release; the registry is still empty.
