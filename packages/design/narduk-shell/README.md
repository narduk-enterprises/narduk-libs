# @narduk-enterprises/narduk-shell

The home of the app-tier `Ne*` component suite: one shared set of tables, empty
states, status chips, page headers, KPI tiles, filter bars, confirm dialogs,
card lists, form pages, admin pages and shells, so that no Nuxt app in the
estate writes its own again.

The suite **wraps Nuxt UI rather than reimplementing it**. Every `Ne*` component
composes `U*` primitives from `@nuxt/ui` (`UEmpty`, `UTable`, `UPageHeader`,
`UDashboardSidebar`, `UPagination`, `UModal`, `UBadge`, `UForm` and friends) and
reads its look from the shared token sheet. It is not a component kit that forks
Nuxt UI, and it is not `narduk-ui`'s replacement — `narduk-ui` keeps owning the
`Ns*` status instruments for the status apps.

Standing decision: company-hq `DECISIONS.md` **D-WEBFOUND-2** and its
**2026-09-11 amendment**. The suite lives here in
`packages/design/narduk-shell`, the `Ne*` prefix is provisional under
D-WEBFOUND-2 Q7's parked renames, and list routes use the `parseListQuery`
contract. The amendment's table-first wave ordering is superseded by the
components backlog in
[`docs/plans/components-library-plan.md`](../../../docs/plans/components-library-plan.md).

## Status

**Tokens and wiring, no components yet.** Backlog item 1
([narduk-libs#248](https://github.com/narduk-enterprises/narduk-libs/issues/248))
built the package, the module, the registration model and the reserved subpaths;
backlog item 2
([narduk-libs#249](https://github.com/narduk-enterprises/narduk-libs/issues/249))
filled `theme.css` with the NE token layer, bridged it onto Nuxt UI's `--ui-*`
variables and added the `app.config` preset. The component registry is still
empty — each later item adds its own component, README section, tests and NE
Base card.

## Install

Published to GitHub Packages under `@narduk-enterprises`. Pin an exact version;
never use a path or workspace-protocol dependency from an app.

```bash
pnpm add -E @narduk-enterprises/narduk-shell
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-shell'],
})
```

Peers: `nuxt >=4.0.0`, `vue >=3.5.0`, and `@nuxt/ui` at exactly `4.6.0` — the
version `@narduk-enterprises/narduk-core` pins, so an app on the Narduk core
layer already has the right one.

### Module options

```ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-shell'],
  nardukShell: {
    // Register the suite's components globally. Default: true.
    // `false` keeps the package installed and the ./format and ./theme.css
    // subpaths importable, but registers no global names.
    components: true,
    // Load the NE token sheet and merge the app.config preset. Default: true.
    // `false` leaves the app on Nuxt UI's own look and is the escape hatch for
    // an app with a finished design era of its own that only wants the markup.
    theme: true,
  },
})
```

With `theme` on, the module does exactly two things:

1. **unshifts `@narduk-enterprises/narduk-shell/theme.css` onto
   `nuxt.options.css`** — the front of the list, so the app's own stylesheets
   are later in source order and still win; and
2. **merges the `app.config` preset as a default** (`defu`, so any value the app
   or another module already set survives). The preset is
   `{ ui: { colors: { primary: 'sky', neutral: 'slate' } } }` and is exported
   from the module entry as `NARDUK_SHELL_APP_CONFIG` if you would rather
   compose it yourself.

`@narduk-enterprises/narduk-core` also defaults `ui.colors`. When both modules
are installed, whichever `setup` runs first supplies the aliases and the other
leaves them alone, so an app that cares sets them in its own `app/app.config.ts`
— which beats both.

## Explicit registration, and why shadowing is loud

The module registers components with one **explicit `addComponent` call per
entry** in a static registry (`src/registry.ts`), and never calls
`addComponentsDir`.

That is deliberate. `addComponentsDir` points Nuxt at a directory and lets it
scan. Nuxt's component resolution then prefers the app's own `app/components/`
over a scanned module directory, so an app that happens to have its own
`app/components/NeStatePanel.vue` **silently** wins: the app renders its local
copy, the suite's copy is never used, and nothing in the build says so. That is
precisely the failure this suite exists to remove — apps quietly keeping their
own fork of a shared component.

An explicit `addComponent` registration collides instead of losing. The conflict
surfaces at build time, in the app, on the name, and whoever added the local
file decides consciously whether to delete it, rename it, or keep it and drop
the shared one.

Adding a component to the suite is therefore two edits, both in this package:
the SFC itself, and its `{ name, filePath }` entry in `src/registry.ts`. Nothing
is registered by being in a folder.

## Reserved subpaths

Exactly three subpaths are exported. One of them is still a reserved
placeholder: it resolves from an external install today (the release pipeline's
consumer fixture proves it) and is filled by the backlog item below, so that no
app has to change an import specifier when the content arrives.

| Subpath                                      | Today                                                                                  | Filled by                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@narduk-enterprises/narduk-shell`           | The Nuxt module                                                                        | Every component item adds a registry entry                                                                    |
| `@narduk-enterprises/narduk-shell/format`    | Empty module (`export {}`)                                                             | Item 5, shared `Intl`-based formatters ([#252](https://github.com/narduk-enterprises/narduk-libs/issues/252)) |
| `@narduk-enterprises/narduk-shell/theme.css` | The NE token layer and its `--ui-*` bridge (see [Styling contract](#styling-contract)) | Filled by item 2 ([#249](https://github.com/narduk-enterprises/narduk-libs/issues/249))                       |

## Styling contract

`narduk-ui`'s third guardrail, extended to this suite: **components read tokens
and never hardcode a colour, radius, shadow or font.** A `Ne*` component reads
`--ne-*`; a `U*` primitive reads `--ui-*`, which `theme.css` points at the same
`--ne-*` tokens; an app restyles both by setting the two brand hooks. No
component in this package may carry a literal colour, and no app should override
component CSS to change one.

One sheet does it. `theme.css` declares the NE tokens and then bridges them onto
the variables the installed Nuxt UI actually reads — `--ui-bg*`, `--ui-text*`,
`--ui-border*`, `--ui-radius`, `--ui-container`, `--ui-header-height`. The
declarations are deliberately **unlayered**: Nuxt UI declares its own defaults
inside `@layer theme`, and an unlayered declaration beats any cascade layer
regardless of stylesheet order.

Schemes follow Nuxt UI exactly. Nuxt UI 4 switches on a class
(`@variant dark (&:where(.dark, .dark *))`) and `@nuxtjs/color-mode` — which
`@narduk-enterprises/narduk-core` installs — is what reads
`prefers-color-scheme` and writes `.light` / `.dark` onto `<html>`. Because the
class matches on any element, a subtree can be pinned with `<div class="dark">`.
A page with no colour-mode runtime opts into the media query by setting
`data-ne-scheme="auto"` on `<html>`; it is opt-in so that a document with no
scheme class renders one deterministic way on every machine.

### Overriding: the two brand hooks

An app sets `--ne-accent` and `--ne-structure` and nothing else. Put them in the
app's own global stylesheet, which the module's `unshift` guarantees is later in
source order than `theme.css`:

```css
/* app/assets/css/main.css */
:root {
  --ne-accent: #1f7a76;
  --ne-accent-soft: #e4efee;
  --ne-accent-ink: #ffffff;
  --ne-structure: #10343a;
}
.dark {
  --ne-accent: #6fc2bd;
  --ne-accent-soft: #123430;
  --ne-accent-ink: #07201d;
  --ne-structure: #07201d;
}
```

Every override must clear the same contrast floor the shipped defaults do —
4.5:1 for `--ne-accent` on `--ne-ground` and `--ne-surface`, and for
`--ne-accent-ink` on `--ne-accent`. `test/theme.test.ts` proves it for the
defaults; an app that changes them owns the same proof (operator-portal#238 is
what happens when nobody does).

To follow Nuxt UI's `primary` alias instead of a literal, write
`--ne-accent: var(--ui-primary)` and set `ui.colors.primary` in
`app/app.config.ts`.

### What is deliberately not themed

- **The colour aliases.** `--ui-primary`, `--ui-secondary`, `--ui-success`,
  `--ui-info`, `--ui-warning` and `--ui-error` are left to Nuxt UI. Each is the
  500/400 shade of an eleven-shade scale that the `solid`, `soft`, `subtle`,
  `outline` and `ghost` variants all read, so repointing one shade would leave a
  button's fill and its hover tint from different palettes. Brand colour is
  `app.config`'s job; the preset supplies the suite's defaults.
- **Status colour.** Freshness and severity belong to `narduk-ui`'s `Ns*`
  instruments and its `--ns-*` signal tokens. `--ne-accent` is interaction, data
  ink and the brand mark — never status.
- **Fonts as files.** The sheet names two families and bundles neither. An app
  serves them (`@nuxt/fonts` in the Narduk core layer); the stacks fall back to
  system faces when it does not.
- **`color-scheme` and form-control chrome.** Nuxt UI's own base layer sets
  `scheme-light dark:scheme-dark` on `body`, and this sheet does not
  second-guess it.
- **The page ground.** `--ne-ground` has no `--ui-*` twin because Nuxt UI has a
  single base background. An app paints the ground itself:
  `body { background: var(--ne-ground) }`.
- **Spacing.** There is no NE space scale. Tailwind's spacing scale is already
  the one every `U*` primitive uses, and a second one would only disagree with
  it.

### Tokens

Light is `:root, .light`; dark is `.dark` (and the opt-in
`[data-ne-scheme="auto"]` media block, which carries the identical
declarations). A value that is the same in both columns is declared in both
blocks, so nothing resolves by accident.

<!-- ne-token-table:start -->

| Token                   | Purpose                                                                          | Light                                                                    | Dark                                                               |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `--ne-ground`           | Page ground behind every panel. Painted by the app on `body`.                    | `#f4f6f7`                                                                | `#0c1216`                                                          |
| `--ne-surface`          | Base panel and card surface.                                                     | `#ffffff`                                                                | `#141c22`                                                          |
| `--ne-surface-muted`    | Muted fill: table headers, quiet sections.                                       | `#f4f6f7`                                                                | `#0f171c`                                                          |
| `--ne-surface-elevated` | Raised fill: inputs, menus, popovers.                                            | `#eef1f3`                                                                | `#1c252d`                                                          |
| `--ne-surface-accented` | Strongest neutral fill: hover, active, wells.                                    | `#e3e8eb`                                                                | `#26313a`                                                          |
| `--ne-surface-inverted` | Inverted chip and tooltip fill.                                                  | `#0e1418`                                                                | `#f3f7f9`                                                          |
| `--ne-ink`              | Headings and the strongest ink.                                                  | `#0e1418`                                                                | `#f3f7f9`                                                          |
| `--ne-ink-body`         | Body text.                                                                       | `#18212a`                                                                | `#dde5ea`                                                          |
| `--ne-ink-secondary`    | Strong secondary text.                                                           | `#3c4a54`                                                                | `#b1bec8`                                                          |
| `--ne-ink-muted`        | Labels and metadata. The lightest ink allowed on text.                           | `#5a6570`                                                                | `#9aa8b3`                                                          |
| `--ne-ink-dimmed`       | Placeholders and disabled chrome. Never body text.                               | `#8b949d`                                                                | `#6d7b85`                                                          |
| `--ne-ink-inverted`     | Ink on an inverted surface.                                                      | `#ffffff`                                                                | `#0c1216`                                                          |
| `--ne-hairline`         | Card and panel hairline.                                                         | `#dde3e7`                                                                | `#243039`                                                          |
| `--ne-divider`          | Row rules and soft dividers.                                                     | `#eaeef1`                                                                | `#1b242b`                                                          |
| `--ne-line-strong`      | Control borders and focus rings.                                                 | `#c9d1d7`                                                                | `#33424d`                                                          |
| `--ne-line-inverted`    | Border on an inverted surface.                                                   | `#0e1418`                                                                | `#f3f7f9`                                                          |
| `--ne-accent`           | Brand hook. Interaction, links, data ink, the brand mark.                        | `#2f6b8f`                                                                | `#63a6cd`                                                          |
| `--ne-accent-soft`      | Accent tint for fills and selected rows.                                         | `#e6eef3`                                                                | `#17303f`                                                          |
| `--ne-accent-ink`       | Ink on an accent fill.                                                           | `#ffffff`                                                                | `#0c1216`                                                          |
| `--ne-structure`        | Brand hook. Structural chrome: rails, headers, bezels.                           | `#18212a`                                                                | `#0c1216`                                                          |
| `--ne-structure-ink`    | Ink on structural chrome.                                                        | `#ffffff`                                                                | `#f3f7f9`                                                          |
| `--ne-radius-base`      | Radius unit. Bridged to `--ui-radius`, so Nuxt UI's radius ramp derives from it. | `0.375rem`                                                               | `0.375rem`                                                         |
| `--ne-radius-control`   | Control radius. Equals Tailwind `rounded-md`.                                    | `calc(var(--ne-radius-base) * 1.5)`                                      | `calc(var(--ne-radius-base) * 1.5)`                                |
| `--ne-radius-panel`     | Panel and card radius. Equals Tailwind `rounded-lg`.                             | `calc(var(--ne-radius-base) * 2)`                                        | `calc(var(--ne-radius-base) * 2)`                                  |
| `--ne-radius-tag`       | Tag, chip and pill radius.                                                       | `9999px`                                                                 | `9999px`                                                           |
| `--ne-shadow-1`         | Resting panel depth.                                                             | `0 1px 2px rgb(14 20 24 / 0.06), 0 0 0 1px rgb(14 20 24 / 0.04)`         | `0 1px 2px rgb(0 0 0 / 0.5), 0 0 0 1px rgb(255 255 255 / 0.05)`    |
| `--ne-shadow-2`         | Raised and overlay depth.                                                        | `0 2px 6px rgb(14 20 24 / 0.08), 0 18px 36px -20px rgb(14 20 24 / 0.28)` | `0 2px 8px rgb(0 0 0 / 0.55), 0 20px 40px -22px rgb(0 0 0 / 0.75)` |
| `--ne-shadow-control`   | Inset control depth.                                                             | `inset 0 1px 2px rgb(14 20 24 / 0.08)`                                   | `inset 0 1px 2px rgb(0 0 0 / 0.45)`                                |
| `--ne-font-sans`        | Language. Instrument Sans, not bundled.                                          | `'Instrument Sans', 'Helvetica Neue', Arial, sans-serif`                 | `'Instrument Sans', 'Helvetica Neue', Arial, sans-serif`           |
| `--ne-font-mono`        | Every measured number. IBM Plex Mono, not bundled.                               | `'IBM Plex Mono', ui-monospace, Menlo, monospace`                        | `'IBM Plex Mono', ui-monospace, Menlo, monospace`                  |
| `--ne-text-display`     | Display size.                                                                    | `38px`                                                                   | `38px`                                                             |
| `--ne-text-title`       | Page title size.                                                                 | `28px`                                                                   | `28px`                                                             |
| `--ne-text-heading`     | Section heading size.                                                            | `22px`                                                                   | `22px`                                                             |
| `--ne-text-body`        | Body size.                                                                       | `15px`                                                                   | `15px`                                                             |
| `--ne-text-small`       | Secondary and dense-table size.                                                  | `13px`                                                                   | `13px`                                                             |
| `--ne-text-label`       | Uppercase mono label size.                                                       | `11px`                                                                   | `11px`                                                             |
| `--ne-leading-tight`    | Line height for display, title and heading.                                      | `1.1`                                                                    | `1.1`                                                              |
| `--ne-leading-body`     | Line height for prose.                                                           | `1.55`                                                                   | `1.55`                                                             |
| `--ne-tracking-tight`   | Tracking for display, title and heading.                                         | `-0.03em`                                                                | `-0.03em`                                                          |
| `--ne-tracking-label`   | Tracking for uppercase mono labels.                                              | `0.12em`                                                                 | `0.12em`                                                           |
| `--ne-container`        | Maximum content width.                                                           | `1320px`                                                                 | `1320px`                                                           |
| `--ne-header-height`    | App header height.                                                               | `4rem`                                                                   | `4rem`                                                             |

<!-- ne-token-table:end -->

### Measured contrast

WCAG 2.2 relative luminance, computed in `test/theme.test.ts` over the shipped
values. Every body ink is asserted against every surface in both schemes; the
worst pair in each row is quoted.

| Pair                                                                      | Light   | Dark    |
| ------------------------------------------------------------------------- | ------- | ------- |
| `--ne-ink-body` on `--ne-surface`                                         | 16.28:1 | 13.51:1 |
| `--ne-ink-muted` on `--ne-surface`                                        | 5.95:1  | 7.08:1  |
| `--ne-ink-muted` on `--ne-surface-accented` (worst surface)               | 4.82:1  | 5.45:1  |
| `--ne-accent` on `--ne-ground`                                            | 5.35:1  | 7.06:1  |
| `--ne-accent-ink` on `--ne-accent`                                        | 5.80:1  | 7.06:1  |
| `--ne-ink-dimmed` on `--ne-surface` (non-text floor, **never body text**) | 3.08:1  | 3.96:1  |

The regression this encodes is
[operator-portal#238](https://github.com/narduk-enterprises/operator-portal/issues/238):
axe measured Nuxt UI's `text-muted` at `#62748e` on `#edf0f4` — 4.16:1 against a
required 4.5:1 — on the rendered `/login` card subtitle and footer. The test
reproduces that pair, asserts it fails, and asserts the shipped `--ne-ink-muted`
clears 4.5:1 on every surface in both schemes, so the same values cannot come
back as a default.

## Components

_Intentionally empty._ This release registers no components.

Each component arrives with its own backlog item, and each adds its section here
— props, slots, events and one example — alongside a mount test, an SSR test and
an NE Base card. The ordered backlog is
[narduk-libs#247](https://github.com/narduk-enterprises/narduk-libs/issues/247)
and the plan it tracks is
[`docs/plans/components-library-plan.md`](../../../docs/plans/components-library-plan.md).

## Publication

Source is TypeScript, Vue and CSS with no build step — the same shape
`narduk-core`, `narduk-analytics` and `narduk-ui` publish. The module adds
`@narduk-enterprises/narduk-shell` to the consuming app's `build.transpile`, so
the app's own Vite build compiles what it imports.
