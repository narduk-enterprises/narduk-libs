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

**Tokens, wiring and first components.** Backlog item 1
([narduk-libs#248](https://github.com/narduk-enterprises/narduk-libs/issues/248))
built the package, the module, the registration model and the reserved subpaths;
item 2
([narduk-libs#249](https://github.com/narduk-enterprises/narduk-libs/issues/249))
filled `theme.css` with the NE token layer, bridged it onto Nuxt UI's `--ui-*`
variables and added the `app.config` preset. Item 9
([narduk-libs#256](https://github.com/narduk-enterprises/narduk-libs/issues/256))
ships `NePageHeader` and `NeSectionHeader`; item 8
([narduk-libs#255](https://github.com/narduk-enterprises/narduk-libs/issues/255))
ships `NeStatusBadge` and `defineStatusMap`; item 16
([narduk-libs#263](https://github.com/narduk-enterprises/narduk-libs/issues/263))
ships `NeConfirmDialog` and `useConfirm()`; item 7
([narduk-libs#254](https://github.com/narduk-enterprises/narduk-libs/issues/254))
ships `NeStatePanel`; item 11
([narduk-libs#258](https://github.com/narduk-enterprises/narduk-libs/issues/258))
ships `NePager` and `useCollection()`, the suite's single-flight paged-list
state machine; item 14
([narduk-libs#261](https://github.com/narduk-enterprises/narduk-libs/issues/261))
ships `NeFilterBar` and `NeSearchInput`; item 5
([narduk-libs#252](https://github.com/narduk-enterprises/narduk-libs/issues/252))
fills the `./format` subpath with the shared `Intl` formatters, which is the
last of the three reserved subpaths to stop being a placeholder; item 19
([narduk-libs#266](https://github.com/narduk-enterprises/narduk-libs/issues/266))
ships `NeForm`, `NeFormSection` and `NeSettingsPage`, and deprecates
narduk-core's `AppSettingsProfile` in favour of `NeSettingsPage`; item 15
([narduk-libs#262](https://github.com/narduk-enterprises/narduk-libs/issues/262))
ships `NeKpiTile` and `NeKpiBand`;
[narduk-libs#528](https://github.com/narduk-enterprises/narduk-libs/issues/528)
ships `NeDataTable`, `NeSortHeader` and `NeCsvDownload` — the `UTable` preset
with column groups, the promoted sort header, and CSV of the rows in view — and
extends `NePager` with a page-size select and a “Show more” mode;
[narduk-libs#601](https://github.com/narduk-enterprises/narduk-libs/issues/601)
ships `NeMeter`, and
[narduk-libs#602](https://github.com/narduk-enterprises/narduk-libs/issues/602)
adds the `--ne-hatch` unreported treatment that `NeMeter` and `NeKpiTile` render
for a figure with no producer. Item 18
([narduk-libs#265](https://github.com/narduk-enterprises/narduk-libs/issues/265))
ships `NeAppShell`, the opt-in sectioned rail, with `useNardukShellSections()`
and the `accent` / `structure` / `sections` module options, and deprecates
narduk-core's `LayerAppShell`, `LayerChromelessShell` and `LayerDashboardShell`
in its favour. Item 21
([narduk-libs#268](https://github.com/narduk-enterprises/narduk-libs/issues/268))
ships the marketing sections — `NeHero`, `NeFeatureGrid`, `NeCta` and
`NeMarketingFooter`, thin themed wrappers over `UPageHero`, `UPageGrid` +
`UPageFeature`, `UPageCTA` and `UFooter`. Components read Nuxt UI semantic
tokens and `UBadge` colour/variant props, and do not hardcode a colour, radius,
shadow or font. Each later item adds its own component, README section, tests
and NE Base card.

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

Peers: `nuxt >=4.0.0`, `vue >=3.5.0`, and `@nuxt/ui` at exactly `4.11.1` — the
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
    // The two brand hooks, as config. Each sets its token app-wide, teleported
    // overlays included; unset sets nothing. See "Overriding: the two brand
    // hooks" below.
    accent: '#1f7a76',
    structure: '#10343a',
    // NeAppShell's rail. Seeds useNardukShellSections(); see NeAppShell below.
    sections: [
      {
        id: 'operate',
        label: 'Operate',
        items: [{ label: 'Overview', to: '/' }],
      },
    ],
  },
})
```

`accent`, `structure` and `sections` reach the runtime through `app.config`,
under the `nardukShell` key, merged as a default (`defu`) — so the app's own
`app/app.config.ts` wins over the module option:

```ts
// app/app.config.ts
export default defineAppConfig({
  nardukShell: { accent: '#7c3aed' },
})
```

Scalars (`accent`, `structure`) are replaced by the app's value. `sections` is
an array, and Nuxt merges array values in `app.config` by concatenating them:
sections set both in `nuxt.config.ts` and in `app.config.ts` all render, the
app's first. To replace the module's sections instead, give `app.config.ts` the
function form, which Nuxt treats as a replacement:
`nardukShell: { sections: () => [...] }`. Setting the rail in one place avoids
the question. Only the options you set are written; an app that sets none gets
no `nardukShell` key. These three are independent of `theme` and `components`,
and `useNardukShellSections()` is auto-imported even with `components: false`.

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

## Adding a component (later backlog items)

Each later lane adds one `Ne*` export with these edits, all in this package. The
module API (`NE_SHELL_COMPONENTS` and `NeComponentRegistration` in
`src/registry.ts`, and the `addComponent` loop in `src/module.ts`) stays
additive: new entries only, no renames or signature changes.
`pnpm run surface:check` (inside `quality:artifacts`) reads that registry — not
a hardcoded list — and fails one line per miss, naming the artefact and the file
to add.

1. Add the SFC at `src/runtime/components/NeThing.vue`. Wrap a Nuxt UI
   primitive. Read tokens; never hardcode a colour, radius, shadow or font.
2. Append `{ name: 'NeThing', filePath: './runtime/components/NeThing.vue' }` to
   `NE_SHELL_COMPONENTS`. That is the only registration path. Do not call
   `addComponentsDir` and do not add a directory scan.
3. Document props, slots, events and one example in this README under a heading
   that names the component (`### NeThing`). A mention in a paragraph or a table
   row does not satisfy the surface check.
4. Add a mount test (`@vue/test-utils`: a `*.test.ts` containing
   `mount(NeThing`; convention `src/runtime/components/NeThing.test.ts`) and an
   SSR test (`renderToString` in vitest's node environment, no `document`;
   `src/runtime/components/NeThing.ssr.test.ts` or a shared `ssr.test.ts` that
   names the component. Pattern:
   `packages/design/narduk-charts/src/ssr.test.ts`).
5. Add `src/design-cards/NeThing.card.vue` with `data-design-card="ne-thing"` —
   copy the template; see **Shipping a design card**.
   `design-system-build/app/app.vue` discovers every `*.card.vue` and renders it
   into the NE Base gallery, so the lane does **not** hand-edit `app.vue`.
6. Add a changeset (`minor` while the package is `0.x`).

A new `./format` export needs (3) and a `*.test.ts` that imports it from
`format` and asserts its output. Mount, SSR and a card are not required of a
function; see **Component surface check**.

`PENDING_CARDS` in `src/pending-cards.ts` (re-exported by
`scripts/check-component-surface.mjs`) is a reviewed, temporary allowlist that
waives **only** (5) for the four parallel component lanes that were written
against a follow-up card PR: `NeStatePanel` (#254), `NeStatusBadge` (#255),
`NePageHeader` and `NeSectionHeader` (#256), `NeConfirmDialog` (#263). README,
mount and SSR still fail closed. The follow-up that adds those cards empties the
list. It is not a way to skip the card forever.

Do not add this package to `create-narduk-app`'s default module list. That is
backlog item 4
([narduk-libs#251](https://github.com/narduk-enterprises/narduk-libs/issues/251)).

## Reserved subpaths

Exactly four subpaths are exported. Three carry app-facing content, resolving
from an external install as soon as they are declared — the release pipeline's
consumer fixture proves this — so that no app had to change an import specifier
when the content arrived. The fourth, `./module`, is not app-facing: it exists
only so Nuxt itself can find the module definition, and no consumer ever writes
it explicitly.

| Subpath                                      | Today                                                                                                                | Filled by                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `@narduk-enterprises/narduk-shell`           | The value-safe barrel: `defineStatusMap`, `NARDUK_SHELL_APP_CONFIG` and the suite's public types                     | Every component item adds a registry entry                                              |
| `@narduk-enterprises/narduk-shell/module`    | The Nuxt module definition, found via an unchanged `modules: ['@narduk-enterprises/narduk-shell']` (narduk-libs#295) | Item 1 ([#248](https://github.com/narduk-enterprises/narduk-libs/issues/248))           |
| `@narduk-enterprises/narduk-shell/format`    | Ten `Intl`-based formatters (see [Formatters](#formatters-format))                                                   | Filled by item 5 ([#252](https://github.com/narduk-enterprises/narduk-libs/issues/252)) |
| `@narduk-enterprises/narduk-shell/theme.css` | The NE token layer and its `--ui-*` bridge (see [Styling contract](#styling-contract))                               | Filled by item 2 ([#249](https://github.com/narduk-enterprises/narduk-libs/issues/249)) |

Install and register the module exactly as before —
`modules: ['@narduk-enterprises/narduk-shell']` in `nuxt.config.ts` — and it
keeps resolving to `./module` without you ever naming that subpath: `@nuxt/kit`
tries a fixed `nuxt`/`nuxt/index`/`module`/`module/index` suffix convention
before it ever falls back to the bare specifier this package's root used to be.

`defineStatusMap` and `NARDUK_SHELL_APP_CONFIG` are named exports of the package
root (`.`). Import them from `@narduk-enterprises/narduk-shell` directly, same
as before:

```ts
import { defineStatusMap } from '@narduk-enterprises/narduk-shell'
```

So are the suite's public types, including `NeConfirmOptions` and
`NeConfirmTone`, so a wrapper around `useConfirm()` can state its own signature
outside Nuxt's auto-import transform:

```ts
import type { NeConfirmOptions } from '@narduk-enterprises/narduk-shell'
```

`useConfirm` itself is reachable through the module's auto-import only, and that
is a deliberate choice rather than an oversight: `use-confirm.ts` imports
`NeConfirmDialog.vue` at module scope to hand the component object to the
overlay, and a value re-export would put that single-file component in every
plain value-import of the package root for no reason — `addImports` already gets
the composable to app code, gated on nothing but the module being installed.
`useCollection` is reachable the same way, for the same reason.

Before the first real adopter (`narduk-enterprises/buoys` PR #44, within an hour
of the 0.1.0 publish), `.` pointed straight at the Nuxt module definition, which
imports `@nuxt/kit`. Nuxt's import-protection plugin refuses any app-code import
of a file that imports `@nuxt/kit`, so that exact
`import { defineStatusMap } from '@narduk-enterprises/narduk-shell'` failed a
production `nuxt build` (narduk-libs#295). `src/index.ts` is `.` now and never
imports `@nuxt/kit`; `test/module.test.ts`'s "root barrel reachability" check
walks its value-import graph and fails the moment that changes again.

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

### What enforces it

`test/styling-contract.test.ts` scans every component **the registry registers**
— the source list is derived from `src/registry.ts`, not written out by hand, so
a component is covered the moment it is registered and cannot be silently left
out. It reads the template, the script and any style block (comments removed)
and rejects a hex, `rgb()`/`hsl()`/`oklch()` literal, a raw `font-family` /
`box-shadow` / `border-radius` declaration, and Tailwind's named radius and
shadow steps. "Raw" is exact: a declaration whose whole value is one token read
— `font-family: var(--ne-font-mono)`, `border-radius: var(--ne-radius-tag)` —
passes, and anything else in the value, a `var()` fallback included, fails. That
narrowing arrived with `NeMeter`, the first component with a `<style scoped>`
block of its own.

Tailwind's **type scale is not** a hardcoded value: under Tailwind v4 `text-sm`
compiles to `font-size: var(--text-sm)` and `font-medium` to
`font-weight: var(--font-weight-medium)`, which is a token read like
`text-muted` is. What the contract forbids there is display type, because the
page's type hierarchy belongs to the app and reaches a component through the
heading element it renders. So body copy may use `text-xs` / `text-sm` /
`text-base` and the one emphasis weight `font-medium`; `text-lg` and up, and
`font-semibold` and heavier, are rejected.

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

#### The config form: `nardukShell.accent` / `.structure`

When one value per token is enough, set it as a module option (or in
`app.config.nardukShell`) instead of writing CSS:

```ts
nardukShell: { accent: '#1f7a76', structure: '#10343a' }
```

The module's brand plugin reads the values from `app.config` and puts one
`<style>` in the document head, in the server's first paint:

```css
:root:root:root,
:root .light,
:root .dark {
  --ne-accent: #1f7a76;
  --ne-structure: #10343a;
}
```

- **Why the head.** Nuxt UI teleports overlays (`UModal`, `USlideover`, the
  shell's own mobile drawer) to `<body>`, outside every component. A rule on the
  document root reaches them; a style on a component's root would stop at that
  component.
- **Why that selector.** `:root:root:root` (specificity 0,3,0) outranks every
  `theme.css` selector that can match `<html>` — `:root`, `.light`, `.dark` and
  `:root[data-ne-scheme='auto']` — without `!important`, and `:root .light` /
  `:root .dark` outrank a scheme-pinned subtree's own class. An app stylesheet
  can still beat it with a more specific selector.
- **One value for both schemes.** The option is a single colour and serves light
  and dark alike; `--ne-accent-soft` and `--ne-accent-ink` are not touched. For
  a separate dark-mode value, or to set the soft and ink tokens, use the CSS
  form above. The contrast floor applies either way.
- **Values are colour values only**: hex, a colour function (`oklch()`,
  `color-mix()`), a `var()` or a keyword. A value containing `;`, braces,
  quotes, `<` / `>` or a backslash is ignored (with a warning in development)
  rather than written into the stylesheet.
- **Neither set, nothing set.** With no `accent` or `structure`, the plugin
  writes no style at all and `theme.css`'s defaults stand.

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

| Token                   | Purpose                                                                          | Light                                                                                 | Dark                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `--ne-ground`           | Page ground behind every panel. Painted by the app on `body`.                    | `#f4f6f7`                                                                             | `#0c1216`                                                                             |
| `--ne-surface`          | Base panel and card surface.                                                     | `#ffffff`                                                                             | `#141c22`                                                                             |
| `--ne-surface-muted`    | Muted fill: table headers, quiet sections.                                       | `#f4f6f7`                                                                             | `#0f171c`                                                                             |
| `--ne-surface-elevated` | Raised fill: inputs, menus, popovers.                                            | `#eef1f3`                                                                             | `#1c252d`                                                                             |
| `--ne-surface-accented` | Strongest neutral fill: hover, active, wells.                                    | `#e3e8eb`                                                                             | `#26313a`                                                                             |
| `--ne-surface-inverted` | Inverted chip and tooltip fill.                                                  | `#0e1418`                                                                             | `#f3f7f9`                                                                             |
| `--ne-ink`              | Headings and the strongest ink.                                                  | `#0e1418`                                                                             | `#f3f7f9`                                                                             |
| `--ne-ink-body`         | Body text.                                                                       | `#18212a`                                                                             | `#dde5ea`                                                                             |
| `--ne-ink-secondary`    | Strong secondary text.                                                           | `#3c4a54`                                                                             | `#b1bec8`                                                                             |
| `--ne-ink-muted`        | Labels and metadata. The lightest ink allowed on text.                           | `#5a6570`                                                                             | `#9aa8b3`                                                                             |
| `--ne-ink-dimmed`       | Placeholders and disabled chrome. Never body text.                               | `#8b949d`                                                                             | `#6d7b85`                                                                             |
| `--ne-ink-inverted`     | Ink on an inverted surface.                                                      | `#ffffff`                                                                             | `#0c1216`                                                                             |
| `--ne-hairline`         | Card and panel hairline.                                                         | `#dde3e7`                                                                             | `#243039`                                                                             |
| `--ne-divider`          | Row rules and soft dividers.                                                     | `#eaeef1`                                                                             | `#1b242b`                                                                             |
| `--ne-line-strong`      | Control borders and focus rings.                                                 | `#c9d1d7`                                                                             | `#33424d`                                                                             |
| `--ne-line-inverted`    | Border on an inverted surface.                                                   | `#0e1418`                                                                             | `#f3f7f9`                                                                             |
| `--ne-hatch`            | Unreported material for a small slot: a meter track, a chip.                     | `repeating-linear-gradient(135deg, var(--ne-ink-dimmed) 0 1px, transparent 1px 6px)`  | `repeating-linear-gradient(135deg, var(--ne-ink-dimmed) 0 1px, transparent 1px 6px)`  |
| `--ne-hatch-soft`       | Unreported material for a large area with its own em-dash.                       | `repeating-linear-gradient(135deg, var(--ne-line-strong) 0 1px, transparent 1px 6px)` | `repeating-linear-gradient(135deg, var(--ne-line-strong) 0 1px, transparent 1px 6px)` |
| `--ne-accent`           | Brand hook. Interaction, links, data ink, the brand mark.                        | `#2f6b8f`                                                                             | `#63a6cd`                                                                             |
| `--ne-accent-soft`      | Accent tint for fills and selected rows.                                         | `#e6eef3`                                                                             | `#17303f`                                                                             |
| `--ne-accent-ink`       | Ink on an accent fill.                                                           | `#ffffff`                                                                             | `#0c1216`                                                                             |
| `--ne-structure`        | Brand hook. Structural chrome: rails, headers, bezels.                           | `#18212a`                                                                             | `#0c1216`                                                                             |
| `--ne-structure-ink`    | Ink on structural chrome.                                                        | `#ffffff`                                                                             | `#f3f7f9`                                                                             |
| `--ne-radius-base`      | Radius unit. Bridged to `--ui-radius`, so Nuxt UI's radius ramp derives from it. | `0.375rem`                                                                            | `0.375rem`                                                                            |
| `--ne-radius-control`   | Control radius. Equals Tailwind `rounded-md`.                                    | `calc(var(--ne-radius-base) * 1.5)`                                                   | `calc(var(--ne-radius-base) * 1.5)`                                                   |
| `--ne-radius-panel`     | Panel and card radius. Equals Tailwind `rounded-lg`.                             | `calc(var(--ne-radius-base) * 2)`                                                     | `calc(var(--ne-radius-base) * 2)`                                                     |
| `--ne-radius-tag`       | Tag, chip and pill radius.                                                       | `9999px`                                                                              | `9999px`                                                                              |
| `--ne-shadow-1`         | Resting panel depth.                                                             | `0 1px 2px rgb(14 20 24 / 0.06), 0 0 0 1px rgb(14 20 24 / 0.04)`                      | `0 1px 2px rgb(0 0 0 / 0.5), 0 0 0 1px rgb(255 255 255 / 0.05)`                       |
| `--ne-shadow-2`         | Raised and overlay depth.                                                        | `0 2px 6px rgb(14 20 24 / 0.08), 0 18px 36px -20px rgb(14 20 24 / 0.28)`              | `0 2px 8px rgb(0 0 0 / 0.55), 0 20px 40px -22px rgb(0 0 0 / 0.75)`                    |
| `--ne-shadow-control`   | Inset control depth.                                                             | `inset 0 1px 2px rgb(14 20 24 / 0.08)`                                                | `inset 0 1px 2px rgb(0 0 0 / 0.45)`                                                   |
| `--ne-font-sans`        | Language. Instrument Sans, not bundled.                                          | `'Instrument Sans', 'Helvetica Neue', Arial, sans-serif`                              | `'Instrument Sans', 'Helvetica Neue', Arial, sans-serif`                              |
| `--ne-font-mono`        | Every measured number. IBM Plex Mono, not bundled.                               | `'IBM Plex Mono', ui-monospace, Menlo, monospace`                                     | `'IBM Plex Mono', ui-monospace, Menlo, monospace`                                     |
| `--ne-text-display`     | Display size.                                                                    | `38px`                                                                                | `38px`                                                                                |
| `--ne-text-title`       | Page title size.                                                                 | `28px`                                                                                | `28px`                                                                                |
| `--ne-text-heading`     | Section heading size.                                                            | `22px`                                                                                | `22px`                                                                                |
| `--ne-text-body`        | Body size.                                                                       | `15px`                                                                                | `15px`                                                                                |
| `--ne-text-small`       | Secondary and dense-table size.                                                  | `13px`                                                                                | `13px`                                                                                |
| `--ne-text-label`       | Uppercase mono label size.                                                       | `11px`                                                                                | `11px`                                                                                |
| `--ne-leading-tight`    | Line height for display, title and heading.                                      | `1.1`                                                                                 | `1.1`                                                                                 |
| `--ne-leading-body`     | Line height for prose.                                                           | `1.55`                                                                                | `1.55`                                                                                |
| `--ne-tracking-tight`   | Tracking for display, title and heading.                                         | `-0.03em`                                                                             | `-0.03em`                                                                             |
| `--ne-tracking-label`   | Tracking for uppercase mono labels.                                              | `0.12em`                                                                              | `0.12em`                                                                              |
| `--ne-container`        | Maximum content width.                                                           | `1320px`                                                                              | `1320px`                                                                              |
| `--ne-header-height`    | App header height.                                                               | `4rem`                                                                                | `4rem`                                                                                |

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

### The unreported treatment

[narduk-libs#602](https://github.com/narduk-enterprises/narduk-libs/issues/602).
A figure can be in one of three states, and each needs a different look:

| State          | What it means                                  | What it looks like                                           |
| -------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| **Zero**       | Something measured, and the answer was `0`.    | An empty track; the digit `0`.                               |
| **Stale**      | Something measured, a while ago.               | The last figure and its age (`narduk-ui`'s freshness chips). |
| **Unreported** | Nothing produced a figure. There is no answer. | The hatch; an em-dash; named "not reported".                 |

The rule for the third: **an unreported figure gets geometry with texture and no
magnitude.** A hatch of 1px diagonals has no length to compare, so it says
"there is a slot here and nothing filled it". An empty bar says "the answer is
zero", which for a figure nobody measured is false. `narduk-ui`'s `NsLevelWell`
had this rule first ("missing wells are hatched with an em-dash, never rendered
empty"); this is the same rule on the NE token layer.

It comes in two shapes, and the second is the one to reach for:

1. **Components take `null` and render it themselves.** `NeMeter` and
   `NeKpiTile` accept a `null` (or `undefined`, or a non-finite number) value
   and draw the treatment on their own, so a call site cannot forget it — pass
   the `null` straight from the API rather than defaulting it to `0`.
2. **A token and a CSS contract**, for a figure in your own markup:

```css
/* The slot keeps its reported size — a row must not reflow when data arrives. */
.my-figure[data-state='unreported'] {
  background-color: var(--ne-surface);
  background-image: var(--ne-hatch); /* or --ne-hatch-soft for a large area */
  color: var(--ne-ink-muted);
}
```

```vue
<script setup lang="ts">
import {
  isUnreported,
  NE_UNREPORTED_TEXT,
} from '@narduk-enterprises/narduk-shell'
import { formatNumber } from '@narduk-enterprises/narduk-shell/format'

const props = defineProps<{ value: number | null }>()
const missing = computed(() => isUnreported(props.value))
</script>

<template>
  <span
    class="my-figure"
    :data-state="missing ? 'unreported' : undefined"
    :role="missing ? 'img' : undefined"
    :aria-label="missing ? NE_UNREPORTED_TEXT : undefined"
    >{{ formatNumber(value) }}</span
  >
</template>
```

The contract, in full:

- **Decide it with `isUnreported(value)`**: `null`, `undefined` or a non-finite
  number (a `NaN` is no more a measurement than a `null` is). A string is a
  caller's own formatted figure and never counts. Exported from the package
  root, and the test `NeMeter` and `NeKpiTile` use.

- **Paint the hatch with `background-image`**, over the slot's own surface
  colour, at the slot's reported size. `--ne-hatch` (drawn in `--ne-ink-dimmed`)
  is for a small slot where the texture is the whole signal — a meter track, a
  chip. `--ne-hatch-soft` (drawn in `--ne-line-strong`) is for a large area that
  carries its own em-dash on top — a tile's value, a chart well.
- **Print an em-dash, never `0` and never blank.** `formatNumber(null)` already
  returns `—`.
- **Name it.** The accessible text is `NE_UNREPORTED_TEXT` (`'Not reported'`,
  exported from the package root), prefixed with the figure's label where there
  is one. Never expose an unreported figure as `aria-valuenow="0"`: `NeMeter`
  switches from `role="meter"` to `role="img"` rather than invent a value.
- **Mark it** with `data-state="unreported"`, which is what the suite's own
  components set and what a test or a stylesheet can select on.

Both tokens derive from existing ink and line tokens, so they follow the scheme
and any override of those tokens with no colour of their own;
`test/theme.test.ts` asserts that they stay 1px diagonals and carry no colour
literal. `NeFilterBar` meets the same rule a different way: an uncounted control
renders no count element at all (see
[A count is your figure, rendered](#a-count-is-your-figure-rendered)).

## Components

Each component arrives with its own backlog item, and each adds its section here
— props, slots, events and one example — alongside a mount test, an SSR test and
an NE Base card. The ordered backlog is
[narduk-libs#247](https://github.com/narduk-enterprises/narduk-libs/issues/247)
and the plan it tracks is
[`docs/plans/components-library-plan.md`](../../../docs/plans/components-library-plan.md).

### NeStatusBadge

Wraps Nuxt UI's `UBadge` with a fixed tone → semantic-colour mapping, so no app
hand-rolls its own tone map again — the motivating bug,
[operator-portal#156](https://github.com/narduk-enterprises/operator-portal/issues/156),
landed the identical tone-map mistake twice in one evening, in two different
components, because the mapping lived twice.

```vue
<NeStatusBadge tone="warn" label="Degraded" />
```

#### Props

| Prop       | Type                                                            | Default                | Notes                                                                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tone`     | `'ok' \| 'warn' \| 'error' \| 'info' \| 'neutral' \| 'pending'` | —, required            | Drives the Nuxt UI semantic colour (tone table below) and is folded into the accessible name.                                                                                                                                     |
| `label`    | `string`                                                        | —, required            | Visible text, and the core of the accessible name.                                                                                                                                                                                |
| `icon`     | `string`                                                        | —                      | Overrides the tone's default icon. Only `pending` has one by default.                                                                                                                                                             |
| `size`     | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl'`                          | `UBadge`'s own default | Passed straight through to `UBadge`.                                                                                                                                                                                              |
| `variant`  | `'solid' \| 'outline' \| 'soft' \| 'subtle'`                    | —                      | Overrides the tone's default variant. Only `pending` has one: `subtle`.                                                                                                                                                           |
| `truncate` | `boolean`                                                       | `false`                | Opt into ellipsis truncation. By default the label never wraps mid-word or truncates — it stays on one line and the badge grows to fit ([operator-portal#156](https://github.com/narduk-enterprises/operator-portal/issues/156)). |

No slots, no emitted events — `NeStatusBadge` is a controlled, presentation-only
wrapper; pass a new `tone`/`label` to change what it shows.

#### Tone → colour

| Tone      | Nuxt UI colour | Default variant | Default icon             |
| --------- | -------------- | --------------- | ------------------------ |
| `ok`      | `success`      | —               | —                        |
| `warn`    | `warning`      | —               | —                        |
| `error`   | `error`        | —               | —                        |
| `info`    | `info`         | —               | —                        |
| `neutral` | `neutral`      | —               | —                        |
| `pending` | `neutral`      | `subtle`        | `i-lucide-loader-circle` |

#### Accessibility

Colour is never the only signal that carries the tone. `NeStatusBadge` sets
`role="status"` and `aria-label="<tone>: <label>"` on the root element, so
assistive tech always hears the tone even when the visible label is
domain-specific and says nothing about severity on its own (`"Major"` vs.
`"error: Major"`).

The tinted variants also carry their own ink. `soft`, `subtle` and `outline`
paint `--ui-<color>` — shade 500 — on a 10% tint of the same colour, which axe
measured on a live app at 2.04:1 (`success`), 1.79:1 (`warning`), 3.30:1
(`error`) and 3.34:1 (`info`) against the 4.5:1 a small badge label needs. Every
status this component exists to report was failing WCAG 1.4.3 wherever a tinted
variant was used. It now sets the badge's text to `--ui-color-<color>-800`,
which is the first shade that clears 4.5:1 on both a white and an elevated
ground (worst case 5.71:1); shade 700 passes on white and lands at 4.02:1 on
elevated. The shade is read through the colour ALIAS, so an app that points
`success` at a different ramp gets that ramp's shade 800.

Two deliberate omissions. **Dark mode is unchanged** — `dark:` restores
`--ui-<color>` exactly, because a dark tint wants a lighter ink rather than a
darker one and nothing has measured it yet. **`solid` is unchanged** — it paints
white on the full colour, so a dark ink would be unreadable rather than merely
low-contrast; its own contrast question (white on `success` shade 500 is about
1.9:1) is a fill-shade decision and no audited surface uses it.

#### `defineStatusMap`

Most consumers have their own status vocabulary — a flood stage, a device health
enum, a job state — that needs to become a `{ tone, label }` pair.
`defineStatusMap` builds that mapping once, typed so a missing union member is a
compile-time error and an unrecognised runtime value falls back to `neutral`
instead of throwing. It is a **named export of the package root**
(`@narduk-enterprises/narduk-shell`, `src/index.ts`) — not a subpath of its own;
the reserved map is `.`, `./module`, `./format`, `./theme.css` (see
[Reserved subpaths](#reserved-subpaths); narduk-libs#295 moved this export off
`src/module.ts`). Nuxt apps that register the module also get it as an
auto-import.

```ts
import { defineStatusMap } from '@narduk-enterprises/narduk-shell'

type FloodStage = 'normal' | 'action' | 'major'

const flood = defineStatusMap<FloodStage>({
  normal: ['ok', 'Normal'],
  action: ['warn', 'Action'],
  major: ['error', 'Major'],
})
```

```vue
<NeStatusBadge v-bind="flood(stage)" />
```

`flood('major')` returns `{ tone: 'error', label: 'Major' }`, which is the
`{ tone, label }` pair `<NeStatusBadge v-bind="flood(stage)" />` accepts.
Omitting a union member from the map (e.g. leaving out `major`) is a TypeScript
error at the `defineStatusMap<FloodStage>({ ... })` call site. A value that
reaches the map at runtime but isn't one of its keys — an API handing back a
stage this union doesn't know about yet — falls back to
`{ tone: 'neutral', label: '<the raw value>' }` rather than throwing.

#### Boundary with `narduk-ui`'s `NsFreshnessChip`

`narduk-ui` already ships `NsFreshnessChip`, a narrower, domain-specific
instrument for the status apps' one specific "how stale is this reading"
indicator. `NeStatusBadge` does not replace, wrap or duplicate it:
`NeStatusBadge` is the general app-tier "here is a tone and a label" primitive,
and `narduk-ui` keeps owning `Ns*` status instruments for the status apps (this
package's own opening boundary note, above). Freshness has its own thresholds
and recency-formatting rules that belong in `NsFreshnessChip`, not in a
`defineStatusMap` map.

#### Deferred

The NE Base card treatment (a standard bordered/padded card shell around a
component) is item 3's mechanism and is not part of this release —
`NeStatusBadge` ships as a standalone component today and adopts the card
convention once item 3 lands it.

### NePageHeader

Wraps Nuxt UI `UPageHeader` and `UBreadcrumb`. Breadcrumbs render above the
title and are omitted when the list is empty or absent. They produce exactly one
navigation landmark: `UBreadcrumb` is itself a `nav`, so this wrapper renders it
bare and only relabels it `Breadcrumb` rather than nesting it in a second `nav`.
The heading is an `h1` by default; set `as` to render a different heading level
without nesting a second heading inside `UPageHeader`'s own `<h1>`.

#### Props

| Prop          | Type                                           | Default | Description                                                               |
| ------------- | ---------------------------------------------- | ------- | ------------------------------------------------------------------------- |
| `title`       | `string`                                       | —       | Page title. Required.                                                     |
| `description` | `string`                                       | —       | Supporting copy below the title.                                          |
| `eyebrow`     | `string`                                       | —       | Small label above the title (maps to `UPageHeader`'s `headline`).         |
| `breadcrumbs` | `NeBreadcrumbItem[]`                           | —       | `UBreadcrumb` items (`label`, optional `to` / `icon`). Hidden when empty. |
| `as`          | `'h1' \| 'h2' \| 'h3' \| 'h4' \| 'h5' \| 'h6'` | `'h1'`  | Heading level for the title.                                              |

`NeBreadcrumbItem` is the `UBreadcrumb` item shape this wrapper accepts:
`{ label?: string, to?: string, icon?: string }` plus any extra fields
`UBreadcrumb` already understands.

#### Slots

| Slot          | Description                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `actions`     | Right-aligned actions next to the title (maps to `UPageHeader`'s `links` slot). Never inside the heading. |
| `default`     | Pass-through of `UPageHeader`'s default slot, below the title/description block.                          |
| `title`       | Overrides the title text. Still rendered inside the heading element.                                      |
| `description` | Overrides the description text.                                                                           |

#### Events

None.

#### Example

```vue
<NePageHeader
  title="Runners"
  description="Every self-hosted runner class."
  eyebrow="Infrastructure"
  :breadcrumbs="[
    { label: 'Infrastructure', to: '/infrastructure' },
    { label: 'Runners' },
  ]"
>
  <template #actions>
    <UButton>New</UButton>
  </template>
</NePageHeader>
```

### NeSectionHeader

A section heading for use below `NePageHeader`. The optional `count` renders as
a Nuxt UI `UBadge` (`color="neutral"`, `variant="subtle"`) next to the title and
is hidden when `count` is `undefined`. Zero is a real, visible count. The count
is formatted through `formatNumber` (`en-US`), never an unpinned
`Intl.NumberFormat()`, so SSR and the browser cannot disagree on grouping. The
heading is an `h2` by default.

#### Props

| Prop          | Type                                           | Default | Description                                                                                  |
| ------------- | ---------------------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `title`       | `string`                                       | —       | Section title. Required.                                                                     |
| `count`       | `number`                                       | —       | Item count shown as a token-themed badge (`formatNumber`, `en-US`). Hidden when `undefined`. |
| `description` | `string`                                       | —       | Supporting copy below the title.                                                             |
| `as`          | `'h1' \| 'h2' \| 'h3' \| 'h4' \| 'h5' \| 'h6'` | `'h2'`  | Heading level for the title.                                                                 |

#### Slots

| Slot      | Description                                                                         |
| --------- | ----------------------------------------------------------------------------------- |
| `actions` | Right-aligned actions next to the title. Never rendered inside the heading element. |
| `default` | Extra content below the title/description row.                                      |

#### Events

None.

#### Example

```vue
<NeSectionHeader title="Recent" :count="12">
  <template #actions>
    <UButton variant="ghost">View all</UButton>
  </template>
</NeSectionHeader>
```

### NeConfirmDialog / useConfirm()

Backlog item 16
([#263](https://github.com/narduk-enterprises/narduk-libs/issues/263)). The
estate's "are you sure?" dialog, and the awaitable composable that opens one
without wiring a `v-model` through a page.

```ts
const confirm = useConfirm()

const ok = await confirm({
  title: 'Close all positions?',
  message: 'Every open position closes at the current market price.',
  confirmLabel: 'Close all',
  tone: 'danger',
  body: TradeSummary,
  props: { symbol, quantity, cashAfter },
})
if (!ok) return
```

`useConfirm()` is auto-imported by the module. Call it from any component — the
app does not mount a `<NeConfirmDialog>` host of its own. The auto-import does
not depend on `components`: setting `nardukShell: { components: false }` opts
out of the suite's global component names, and the composable resolves its
dialog by importing it rather than by global name, so it keeps working.

#### Host mechanism

The composable is built on Nuxt UI's `useOverlay`. That is the host: `open()`
mounts `NeConfirmDialog` into the overlay stack and `close(boolean)` is what
`await confirm(...)` resolves with. The stack lives on `UApp` (or a bare
`UOverlayProvider`), which every Narduk app already has — narduk-core's
`LayerAppShell` wraps the tree in `UApp`. There is no module-registered host
component and no layout wiring.

One handle drives one dialog at a time. Sequential calls resolve independently,
and leftover `pending` / `error` from a rejected `onConfirm` is reset on the
next `open`.

A second `confirm()` started before the first settles **supersedes** it rather
than racing it — a double-click on a row-level "Delete?" is the case this is
written for. The new options take the dialog over, and the superseded call
resolves `false`: the user is being asked a different question now, so they did
not confirm the old one, and the caller's `if (!ok) return` does the safe thing
with no extra branch. The one exception is a superseded call whose `onConfirm`
is still in flight; that work cannot be unrun, so its promise is kept and
settles with the real outcome. No call is ever left holding a promise that
cannot settle, and no in-flight handler writes to a dialog it no longer owns.

The declarative form is the same component with a model:

```vue
<NeConfirmDialog
  v-model:open="showEndGame"
  title="End game?"
  message="Positions are closed at market and standings are final."
  confirm-label="End game"
  tone="danger"
  :pending="ending"
  :error="endGameError"
  @confirm="endGame"
/>
```

#### Props

| Prop           | Type                      | Default           | Notes                                                                |
| -------------- | ------------------------- | ----------------- | -------------------------------------------------------------------- |
| `open`         | `boolean`                 | `false`           | `v-model:open`. Nuxt UI v4's overlay model.                          |
| `title`        | `string`                  | `'Are you sure?'` | The dialog's accessible name (`aria-labelledby`).                    |
| `message`      | `string`                  | `''`              | The accessible description (`aria-describedby`).                     |
| `confirmLabel` | `string`                  | `'Confirm'`       |                                                                      |
| `cancelLabel`  | `string`                  | `'Cancel'`        |                                                                      |
| `tone`         | `'default' \| 'danger'`   | `'default'`       | `danger` → `error`-coloured confirm button, and Cancel takes focus.  |
| `pending`      | `boolean`                 | `false`           | Confirm loading, cancel disabled, dismissal off. See below.          |
| `error`        | `string`                  | `''`              | Rendered in the body as a `role="alert"` live region.                |
| `body`         | `Component`               | —                 | Rendered in the dialog body, before the `#body` slot.                |
| `props`        | `Record<string, unknown>` | —                 | Props for `body`. Named `props` to match `confirm({ body, props })`. |

#### Slots

| Slot   | Notes                                                                    |
| ------ | ------------------------------------------------------------------------ |
| `body` | Rich body content. Renders after the `body` component when both are set. |

#### Events

| Event         | Payload   | Notes                                                              |
| ------------- | --------- | ------------------------------------------------------------------ |
| `confirm`     | —         | Confirm pressed. **The dialog stays open** — see below.            |
| `cancel`      | —         | Cancel, Escape or an outside click. The dialog is already closing. |
| `close`       | `boolean` | The overlay result `useOverlay` resolves `confirm()` with.         |
| `after:leave` | —         | Forwarded from `UModal` so a closed overlay can unmount.           |

#### Confirming does not close the dialog

`@confirm` fires and the dialog stays open, so the owner can flip `:pending`
while its async work runs. That is exactly the contract narduk-core's
`AppConfirmModal` and stonx's `CommonConfirmModal` already have, so adopting the
suite is not a behaviour change for either. `useConfirm()` closes it for you.

#### Pending (`preventClose`)

While `pending` is true the confirm button shows its loading state, the cancel
button is disabled, and Escape and outside clicks are ignored (Nuxt UI's
`dismissible: false`). Nothing can dismiss the dialog mid-flight.

With an async `onConfirm` the composable drives all of that for you:

```ts
const ok = await confirm({
  title: 'End game?',
  message: 'Positions are closed at market and standings are final.',
  tone: 'danger',
  onConfirm: () => endGame(gameId),
})
```

The dialog goes pending the moment the user confirms, and:

- **resolves** → the dialog closes and `confirm()` returns `true`;
- **rejects** → the dialog **stays open**, leaves pending, and the rejection is
  surfaced through the `error` prop (`error.message`, or a generic fallback).
  The user can retry or cancel, and `confirm()` only settles once they do —
  `false` if they back out.

#### Focus

Initial focus lands on the **least destructive** button: **Cancel** for
`tone="danger"`, **Confirm** otherwise. Reka's default is the first tabbable
child, which for a destructive dialog puts the irreversible action one Return
press away.

`aria-modal="true"` is declared on the dialog. The containment behind that claim
— the Tab/Shift-Tab trap, wrapping at both ends, and focus restoration to the
opening control — is **Reka UI's `FocusScope`**, which Nuxt UI's `UModal`
mounts; this component does not re-implement it. Everything outside the dialog
is also `aria-hidden` while it is open, which is Reka's own mechanism and the
part that makes the `aria-modal` claim true rather than decorative.

The mount tests assert what a DOM-in-JS environment can actually prove:
`aria-modal`, the `aria-labelledby`/`aria-describedby` wiring, the Reka dialog
role and dismissable-layer, the outside `aria-hidden`, and where initial focus
lands. Sequential Tab navigation is browser behaviour that no DOM shim
implements, so that specific half is delegated to Reka and stated here rather
than asserted there. The bug class this closes is operator-portal#134: a
declared `aria-modal` with Tab not trapped.

#### What it is not for

Confirmation, not workflow. operator-portal's preview-token flows stay bespoke
(plan §2 item 16) — a dialog that mints something, shows a secret, or carries
its own multi-step form is not this component. `NeConfirmDialog` answers one
yes/no question about an action the user already chose.

#### Supersedes

narduk-core's `AppConfirmModal`, deprecated in the same release as this one
under D4 and removed in the next narduk-core major. Migration mapping is in
[narduk-core's README](../../modules/narduk-core/README.md).

### NeStatePanel

One panel for the five readings a data surface actually has: **empty · loading ·
error · blocked · absent**. It wraps `UEmpty` (`empty`/`absent`), `USkeleton`
(`loading`) and `UAlert` (`error`/`blocked`).

It has five readings rather than the usual "empty or not" because of the bug
class that forecloses. A surface that cannot tell **unknown** from **zero**
renders a confident `0`, a green "queue clear" that nothing can know is clear,
or a red `UNKNOWN` on a thirty-second-old feed — and the operator learns to
ignore the cell (operator-portal
[#183](https://github.com/narduk-enterprises/operator-portal/issues/183),
[#162](https://github.com/narduk-enterprises/operator-portal/issues/162),
[#100](https://github.com/narduk-enterprises/operator-portal/issues/100),
[#21](https://github.com/narduk-enterprises/operator-portal/issues/21);
[#282](https://github.com/narduk-enterprises/operator-portal/issues/282) asks
for exactly this component). So:

| Reading   | Means                                         | Not                   |
| --------- | --------------------------------------------- | --------------------- |
| `loading` | the read has not answered yet                 | a zero                |
| `empty`   | the read answered and found nothing           | a failure             |
| `absent`  | **no producer publishes this fact at all**    | a zero, and not a bug |
| `blocked` | a read this surface depends on did not answer | a zero                |
| `error`   | the read failed                               | an empty set          |

`absent` is visually and textually distinct from `empty` and from `loading`, by
shape as well as by hue: a dashed box is a placeholder for a set, a dotted left
rule is a fact nobody publishes sitting beside facts that are, and a solid box
is a read still in flight. A mount test pins that the three differ.

#### Example

```vue
<NeStatePanel
  :state="status"
  title="No runners"
  message="No runner has registered with the fleet yet."
  icon="i-lucide-server"
>
  <template #action><UButton to="/runners/new">Add one</UButton></template>
</NeStatePanel>
```

#### Props

| Prop           | Type                                  | Default   | What it does                                                                    |
| -------------- | ------------------------------------- | --------- | ------------------------------------------------------------------------------- |
| `state`        | `NeStateValue`                        | —         | `'empty' \| 'loading' \| 'error' \| 'blocked' \| 'absent'`. Wins over `status`. |
| `status`       | `NeAsyncDataStatus`                   | —         | `useAsyncData()`'s status, bound straight through. See the mapping below.       |
| `title`        | `string`                              | `''`      | The headline.                                                                   |
| `message`      | `string`                              | `''`      | The sentence under it.                                                          |
| `icon`         | `string`                              | per state | Overrides the state's own icon.                                                 |
| `eyebrow`      | `string`                              | per state | The state's name, rendered as text. Override the wording, not the presence.     |
| `gaps`         | `ReadonlyArray<string \| NeStateGap>` | `[]`      | Named provisioning gaps, rendered as a list — never folded into prose.          |
| `unblocksOn`   | `string`                              | `''`      | The condition that would end this state.                                        |
| `unblocksRef`  | `string`                              | `''`      | An issue or file reference beside the condition, e.g. `operator-portal#152`.    |
| `unblocksHref` | `string`                              | `''`      | Links the reference if there is one, otherwise the condition itself.            |
| `as`           | `string`                              | `'div'`   | `'section'` when the panel **is** the section's content.                        |

`NeStateGap` is `{ id: string; need: string }`; a plain string is the same thing
without an identifier. `gaps`, `unblocksOn`, `unblocksRef` and `unblocksHref`
are ported from operator-portal's `StatePanel.vue`.

#### Slots

| Slot      | When it renders                                                      |
| --------- | -------------------------------------------------------------------- |
| `default` | when there is **no** state — this is the content the panel replaces. |
| `action`  | inside the panel, under everything else. A `UButton`, usually.       |

#### Events

None. The panel is a reading, not a control; anything clickable goes in
`#action`.

#### Binding `useAsyncData`

```vue
<script setup lang="ts">
const { data, status } = await useAsyncData('runners', () =>
  $fetch('/api/runners'),
)
</script>

<template>
  <NeStatePanel
    :status="status"
    :state="status === 'success' && !data?.length ? 'empty' : undefined"
    title="No runners"
    message="No runner has registered with the fleet yet."
  >
    <RunnerTable :rows="data" />
  </NeStatePanel>
</template>
```

| `status`    | Renders                                       |
| ----------- | --------------------------------------------- |
| `'idle'`    | `loading` — the read has not started          |
| `'pending'` | `loading`                                     |
| `'error'`   | `error`                                       |
| `'success'` | **the default slot** — success is not a state |

`success` is deliberately not a state: a successful read with rows is the
default slot's job, and a successful read with **none** is `empty`, which only
the caller can know. That is why `state` takes precedence over `status` whenever
it is set — the two compose, as above.

#### Accessibility

By construction, not by caller discipline:

- `loading` → `role="status"`, `aria-live="polite"`, `aria-busy="true"`; the
  shimmer itself is `aria-hidden`.
- `error` → `role="alert"` **via `UAlert`** (assertive, and only on the alert
  itself, so roles do not nest).
- `empty` / `absent` / `blocked` → `role="status"`.
- Every state renders its own name as text, so no reading depends on colour.
- `absent` and `blocked` never render as an empty list.

Both the mount suite and the SSR suite assert these, the SSR one because a
`role="alert"` that appears only after hydration is not there when it matters.

#### Types

```ts
import type {
  NeAsyncDataStatus,
  NeStateGap,
  NeStatePanelProps,
  NeStateValue,
} from '@narduk-enterprises/narduk-shell'
```

#### Supersedes

`narduk-core`'s `AppEmptyState` (D4, Logan 2026-09-11: "Deprecate, remove next
major"). It is deprecated in the same release as this component and removed in
the next `narduk-core` major; the migration mapping is in
[that package's README](../../modules/narduk-core/README.md#deprecated-components).

### NePager / useCollection()

The foot of a paged list, and the state machine behind it. Backlog item 11
([narduk-libs#258](https://github.com/narduk-enterprises/narduk-libs/issues/258)).

`useCollection()` is the component here; `NePager` is the small part you can
see. The composable owns the concurrency rules that every list in the estate got
wrong separately, and the pager is deliberately incapable of breaking them —
assigning `v-model:state` applies `page` and nothing else. Page-size and “Show
more” emit `update:limit` for `useCollection().setLimit`, which resets to page 1
by its own rule.

The wire shape is not this package's to invent: the query and response are
`@narduk-enterprises/narduk-platform/list-query`, served by `parseListQuery` +
`listResponse` in `narduk-core` (item 10). `useCollection` imports the
contract's own `LIST_QUERY_DEFAULT_LIMIT`, maximum `q` length and reserved-key
list rather than restating them.

#### The five rules it enforces

| Rule                                                                                                                                                 | What it prevents                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single flight.** One request in flight. Triggers that arrive during it coalesce into **one** follow-up, and the superseded request is `abort()`ed. | A filter panel that fires five requests for five clicks, and a server paying for four answers nobody reads.                                                                                 |
| **Stale-scope discard.** A response whose scope token no longer matches the current state is never rendered.                                         | The out-of-order render: request A (slow, page 1) landing after request B (fast, page 2) and putting page 1 back on screen.                                                                 |
| **Debounced `q`** (250 ms; `debounce: 0` in a test).                                                                                                 | One request per keystroke.                                                                                                                                                                  |
| **`page` resets to 1** when `q`, a filter, `sort` or `limit` changes.                                                                                | The search-after-page bug — searching from page 7 and getting an empty result set that has matches (stonx#219, #218, #5).                                                                   |
| **`limit` and `page` are clamped**, `page` against the response that actually landed.                                                                | An empty last page after a delete. Deleting the 26th of 26 rows at `limit: 25` lands the reader on page 1 — the new last page — in exactly **one** extra request, not an O(page) walk back. |

Each of those is pinned by a test that asserts a **request count**, in
`test/use-collection.test.ts`. A test asserting only the rendered rows passes
for a broken single-flight implementation, which is why none of them do that.

#### Example

```vue
<script setup lang="ts">
const c = useCollection<Runner>({
  fetch: (query, { signal }) => $fetch('/api/runners', { query, signal }),
  limit: 25,
  sortable: ['name', 'lastSeenAt'],
  syncQuery: true,
})
</script>

<template>
  <NeSearchInput
    v-model="c.q"
    :debounce="0"
    label="Search runners"
    placeholder="Search runners"
  />
  <NeStatePanel
    :state="c.pending && c.items.length === 0 ? 'loading' : undefined"
  >
    <ul>
      <li v-for="runner in c.items" :key="runner.id">{{ runner.name }}</li>
    </ul>
  </NeStatePanel>
  <NePager
    v-model:state="c.state"
    noun="runners"
    :page-sizes="[25, 50, 100]"
    :to="(page) => ({ query: { ...$route.query, page } })"
    @update:limit="c.setLimit"
  />
</template>
```

`useCollection` is auto-imported by the module. `NePager` is registered from
`src/registry.ts` like every other component.

#### `useCollection(options)`

| Option           | Type                                        | Default                | Notes                                                                                                                                             |
| ---------------- | ------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch`          | `(query, { signal }) => Promise<TRaw>`      | —                      | Required. Called at most once per settled intent. Forward `signal` and a superseded request is actually cancelled, not merely ignored.            |
| `adapter`        | `(raw: TRaw) => OffsetListResponse<TItem>`  | —                      | For a route not yet on `listResponse`. Drop it once the route migrates.                                                                           |
| `debounce`       | `number`                                    | `250`                  | `q` only. `0` disables it.                                                                                                                        |
| `enabled`        | `MaybeRefOrGetter<boolean>`                 | `true`                 | False while the page has no scope to ask with; a scoped list called with no scope is a 400 by design. Fetches by itself the moment it turns true. |
| `filters`        | `MaybeRefOrGetter<Record<string, unknown>>` | `{}`                   | Extra query keys. A change resets to page 1. A key colliding with the contract's reserved keys throws, naming the key.                            |
| `immediate`      | `boolean`                                   | `true`                 | `false` for an SSR page that `await c.refresh()`s.                                                                                                |
| `limit`          | `number`                                    | contract default (25)  | Clamped to `maxLimit`, then to whatever the route echoes back.                                                                                    |
| `maxLimit`       | `number`                                    | none                   | Optional client-side ceiling. The route's own ceiling wins regardless, because the clamp follows the `limit` the response echoes back.            |
| `maxQueryLength` | `number`                                    | contract default (200) | Longest `q` put on the wire.                                                                                                                      |
| `sort`           | `string \| null`                            | `null`                 | Wire form, `'<key>:<asc\|desc>'`.                                                                                                                 |
| `sortable`       | `readonly string[]`                         | —                      | Allowlist. Gates `setSort` **and** what a URL may set, so `?sort=passwordHash:asc` is dropped rather than forwarded.                              |
| `syncQuery`      | `boolean`                                   | `false`                | Mirror `page`/`q`/`sort` in the route query.                                                                                                      |

Returns a `reactive` object: `items`, `page`, `pageCount`, `total`, `pending`,
`error`, `canNext`, `canPrevious`, `sort`, `q` (bind the search box to it — it
is the keystroke value, applied after the debounce), `state`, and the mutators
`setPage`, `setLimit`, `setSort` and `refresh()`. `refresh()` resolves when the
collection has **settled**, including a clamp refetch, so an SSR
`await c.refresh()` never serialises an empty page.

#### `syncQuery: true`

Reads `page`, `q` and `sort` out of the URL **before** the first request — one
request, already for page three, not page one plus a correction — and writes
them back on change. Defaults are omitted, so page one is `?` and never
`?page=1`: two URLs for one page is a duplicate for a crawler, and this pager
exists to be crawled. Query keys the collection does not own are left exactly as
they were. It needs `useRoute()`/`useRouter()`, so it throws a named error
outside a router; that is why `vue-router` is a declared peer.

#### NePager props

| Prop           | Type                                 | Default     | Notes                                                                                                          |
| -------------- | ------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `state`        | `NeCollectionState<T>`               | —           | Required, `v-model:state`. Assigning applies `page` and nothing else.                                          |
| `density`      | `'default' \| 'dense'`               | `'default'` | `dense` is pacc-trac's `DenseListPager`.                                                                       |
| `noun`         | `string`                             | `'results'` | The word in the summary: `51–75 of 712 runners`. Window and total are formatted with `formatNumber` (`en-US`). |
| `siblingCount` | `number`                             | `2`         | Passed to `UPagination`.                                                                                       |
| `showControls` | `boolean`                            | `true`      | First/last controls on the counted shape.                                                                      |
| `showSummary`  | `boolean`                            | `true`      | Turn off to render your own.                                                                                   |
| `to`           | `(page: number) => RouteLocationRaw` | —           | Renders every control as a real `<a href>`.                                                                    |
| `pageSizes`    | `readonly number[]`                  | —           | Options for a “25 per page” select. Omit for no select. Changing the size emits `update:limit`.                |
| `mode`         | `'pages' \| 'more' \| 'auto'`        | `'pages'`   | `'more'` is a “Show 25 more” button that grows the limit. `'auto'` is numbered pages from `sm` up, both below. |
| `moreStep`     | `number`                             | first limit | How many rows “Show more” adds. Defaults to the limit the pager first saw.                                     |
| `maxLimit`     | `number`                             | —           | The route’s page-size ceiling. At the ceiling, “Show more” gives way to numbered pages.                        |

#### NePager slots and events

| Slot      | Props                | Notes                                           |
| --------- | -------------------- | ----------------------------------------------- |
| `summary` | `{ state, summary }` | Replaces the sentence, keeping the live region. |

| Event          | Payload                | Notes                                                                                                            |
| -------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `update:state` | `NeCollectionState<T>` | The current state with a new `page`. Emitted only when the page actually changes.                                |
| `update:limit` | `number`               | A new page size. The page-size select and “Show more” emit this; the pager never writes `limit` through `state`. |

#### Two shapes, because `total` is optional

`listResponse` returns `total: null` unless the route opts into counting, so a
page-numbered control would be inventing a number. `NePager` renders
`UPagination` with real page numbers when `total` is a number, and Previous/Next
driven by `hasPrevious`/`hasNext` when it is `null`.

#### `:to` emits real hrefs

With `:to`, every control is an `<a href>` resolved through the router, so a
crawler follows page two and a middle-click opens it in a tab (riverstatus's
rivers list is the pilot). `test/NePager.ssr.test.ts` renders the **real**
`UPagination` through a real router in the `node` environment and asserts the
`href`s in the server output — a stub emitting its own anchors would prove
nothing about the shipped component.

Nothing is disabled while a request is in flight: disabling a link takes
middle-click and "open in new tab" away from a reader for 200 ms. The summary
carries `aria-busy` instead.

#### Page size and “Show more”

[narduk-libs#528](https://github.com/narduk-enterprises/narduk-libs/issues/528).
Both the “25 per page” select and the phone “Show 25 more” button change the
**limit**, which this pager’s model deliberately cannot write. They emit
`update:limit` for `useCollection().setLimit` — which resets to page 1 by its
own rule, so a grown page is rows 1–50 in one request and the list keeps its
scroll.

`'more'` only offers itself on page one with more to come and headroom under
`maxLimit`; anywhere else the numbered pages show, because a button that cannot
do what it says is worse than a page link. `'auto'` renders both, split by
breakpoint classes (`sm:hidden` / `max-sm:hidden`), so the server needs no
viewport.

#### Offset mode only, deliberately

The contract also has a cursor form. `useCollection` implements the offset form
and nothing else, because a cursor collection cannot answer "how many pages",
which is the question `NePager`'s counted shape exists to answer. A cursor list
wants a different control (a "Load more"), so it should be a different
composable rather than a mode flag that makes half of this API meaningless.

#### Types

```ts
import type {
  NeCollection,
  NeCollectionFetchContext,
  NeCollectionOptions,
  NeCollectionQuery,
  NeCollectionState,
  NePagerProps,
} from '@narduk-enterprises/narduk-shell'
```

### NeFilterBar

The filter row above a collection. Backlog item 14
([narduk-libs#261](https://github.com/narduk-enterprises/narduk-libs/issues/261)),
promoted from operator-portal's `FilterBar.vue`, where nine pages had each
hand-assembled the row with its own pressed logic, its own count and its own
disabled treatment. The pressed-chip count inversion was carried nine times and
fixed nine times.

`NeSearchInput` is the other half of item 14: a search is a text control
**beside** the row, not a member of it, and the two have no shared state. Bind
the field to `useCollection()`'s `c.q` with `:debounce="0"` — that composable
already applies the 250 ms window.

#### Three kinds, one DOM shape

A wrapping row of buttons in the order you pass them — nothing sorted, nothing
hidden. They differ in what they mean, and the ARIA follows the meaning:

| `kind`   | Row role  | Control state                | For                                             |
| -------- | --------- | ---------------------------- | ----------------------------------------------- |
| `chips`  | `group`   | `aria-pressed`               | Toggling a filter on and off.                   |
| `facets` | `group`   | `aria-pressed`               | Choosing a scope. Same mechanics, quieter fill. |
| `tabs`   | `tablist` | `aria-selected` + `tabindex` | Switching views. Full APG keyboard model.       |

`tabs` is a real tablist: arrows move and wrap, `Home` and `End` jump to the
ends, and exactly **one** tab sits in the page's tab order at a time (the
selected one, or the first when nothing is selected). Your panels name the tab
that controls them through `idPrefix` — `<prefix>-tab-<key>` and
`<prefix>-panel-<key>`.

A **disabled tab is not a destination**: arrows, `Home` and `End` all walk past
it to the next enabled one. APG omits disabled tabs from the roving model, and
the reason is mechanical here — selection never moves onto a disabled item, so
focusing one would leave `aria-selected` behind on the tab the user came from,
and the next `Tab` would exit the list from a control the tablist does not
consider current. A row whose tabs are all disabled keeps focus and selection
where they are.

The `tablist` role sits on the **control row**, not on the outer wrapper: a
tablist's required owned elements are tabs, and `note` is a caption while the
`after` slot is an action. Both render as siblings of the tablist. If you are
asserting the role in a test, the selector is `[data-ne-filter-controls]`;
`[data-ne-filter-bar]` is the outer row and carries `data-ne-filter-kind`.

#### A filter with no producer stays in the row

`item.disabled` renders `aria-disabled` and keeps the control **visible**. This
is the component's one real opinion, and it is why the disabled state is part of
the API rather than something a caller does with a `v-if`:

> Dropping a filter whose rows do not exist yet makes the product look finished
> and be silently narrower than it claims. The control stays, the row's `note`
> says when it lands, and nobody has to work out whether a filter is missing or
> merely unbuilt.

It is `aria-disabled`, never the `disabled` attribute. A disabled button leaves
the tab order, and a keyboard user then cannot reach it to read the reason in
its `title`.

That reachability holds for `chips` and `facets`. Under `tabs` it does **not**:
APG skips disabled tabs in the roving model, as above, so no arrow key ever
lands on one and `title` is mouse-only there. A disabled tab is therefore given
`aria-describedby` pointing at the row's `note`, which a screen reader reads in
browse mode whether or not focus can arrive — so **write a `note` on a tabs row
that has disabled tabs**, or their reason reaches nobody.

#### A count is your figure, rendered

`item.count` is displayed and never derived — the component cannot know what a
control filters, and a count computed here would eventually disagree with the
group heading computed where the rows are.

**Omit the count rather than passing `0` for "not counted".** `0` is a
measurement; an absent count is not. A control rendering `0` for "we did not
count" is the same lie a hatched bar exists to avoid, and the row renders no
count element at all when you leave it out.

#### Props

| Prop         | Type                            | Default    | Notes                                                           |
| ------------ | ------------------------------- | ---------- | --------------------------------------------------------------- |
| `items`      | `NeFilterBarItem[]`             | —          | Rendered in the order given.                                    |
| `label`      | `string`                        | —          | Required. The row's accessible name.                            |
| `kind`       | `'chips' \| 'facets' \| 'tabs'` | `'chips'`  |                                                                 |
| `modelValue` | `string \| null`                | `null`     | The selected key. `null` is "nothing selected".                 |
| `note`       | `string`                        | —          | A caption — when the disabled controls land, typically.         |
| `flush`      | `boolean`                       | `false`    | Drop the top margin in a container that already spaces the row. |
| `idPrefix`   | `string`                        | `'filter'` | Tabs only: the prefix your `tabpanel`s are named under.         |

`NeFilterBarItem`: `key`, `label`, and optional `count`, `disabled`, `title`,
`testid`, `attrs`. An `undefined` value in `attrs` is dropped rather than
rendered as the string `"undefined"`.

#### Events and slots

`update:modelValue` emits the chosen `key`. The component never moves the
selection itself — the caller owns it, which is what makes `v-model` and a
URL-synced selection the same code path. Slot `after` appends to the row.

#### Types

```ts
import type {
  NeFilterBarItem,
  NeFilterBarKind,
  NeFilterBarProps,
} from '@narduk-enterprises/narduk-shell'
```

#### Example

```vue
<script setup lang="ts">
const state = ref<string | null>('open')
</script>

<template>
  <NeFilterBar
    v-model="state"
    label="State"
    :items="[
      { key: 'all', label: 'All', count: 24 },
      { key: 'open', label: 'Open', count: 7 },
      { key: 'draft', label: 'Draft' },
      {
        key: 'owner',
        label: 'By owner',
        disabled: true,
        title: 'Lands with the owner ledger',
      },
    ]"
    note="By owner lands with the owner ledger"
  />
</template>
```

### NeSearchInput

The search field beside a collection. Backlog item 14
([narduk-libs#261](https://github.com/narduk-enterprises/narduk-libs/issues/261)),
built fresh — operator-portal's chips half had no search of its own, and no
stonx filter bar debounces or syncs today. It wraps Nuxt UI's `UInput`.

`v-model` is the **applied** term, not the keystroke. The box updates as you
type; the model updates after `debounce` ms (250, the same window
`useCollection` uses for `q`). A page that is not on `useCollection` still gets
one request per settled query rather than one per keystroke.

Bind `v-model="c.q"` with `:debounce="0"`. `c.q` is the keystroke value — the
collection applies it after its own 250 ms — so a second debounce here would
make "GTM1500" wait half a second twice.

The trailing clear is the item's **reset**: it empties the box and the model in
the same tick. A reset that waited out the debounce would keep the previous term
live after the reader asked it to stop. The optional summary (`showSummary`) is
the **active-filter** readout — a live region that names the applied term, which
can lag the box while the debounce is open.

Length is the list-query contract's length
(`LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH`, 200) so a `q` that cannot travel is
never typed.

#### Props

| Prop          | Type                                   | Default              | Notes                                                       |
| ------------- | -------------------------------------- | -------------------- | ----------------------------------------------------------- |
| `label`       | `string`                               | —                    | Required. The field's accessible name.                      |
| `modelValue`  | `string`                               | `''`                 | The applied term. `''` is "no search".                      |
| `debounce`    | `number`                               | `250`                | `0` emits on every keystroke — the `useCollection` binding. |
| `placeholder` | `string`                               | —                    | Hint while empty. Not the accessible name.                  |
| `pending`     | `boolean`                              | `false`              | Forwards to `UInput`'s `loading` and sets `aria-busy`.      |
| `disabled`    | `boolean`                              | `false`              | Hides the clear control too.                                |
| `showSummary` | `boolean`                              | `false`              | Live region naming the applied term.                        |
| `maxLength`   | `number`                               | contract default 200 | Hard ceiling on what can be typed.                          |
| `size`        | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl'` | `'sm'`               | Sits next to `NeFilterBar`'s `xs` chips.                    |
| `name`        | `string`                               | —                    | Native `name`, for a field that submits with a form.        |

`update:modelValue` emits the applied string. The component never writes a URL
or resets a page — those are `useCollection`.

#### Types

```ts
import {
  NE_SEARCH_DEBOUNCE_MS,
  type NeSearchInputProps,
  type NeSearchInputSize,
} from '@narduk-enterprises/narduk-shell'
```

#### Example

```vue
<script setup lang="ts">
const q = ref('')
const state = ref<string | null>('open')
</script>

<template>
  <NeSearchInput
    v-model="q"
    :debounce="250"
    label="Search runners"
    placeholder="Search runners"
  />
  <NeFilterBar
    v-model="state"
    label="State"
    :items="[
      { key: 'all', label: 'All', count: 24 },
      { key: 'open', label: 'Open', count: 7 },
    ]"
  />
</template>
```

With `useCollection`:

```vue
<NeSearchInput
  v-model="c.q"
  :debounce="0"
  label="Search runners"
  placeholder="Search runners"
  :pending="c.pending"
/>
```

### NeDataTable

The estate’s data-table preset on Nuxt UI’s `UTable`
([narduk-libs#528](https://github.com/narduk-enterprises/narduk-libs/issues/528)).
The eslint pack already forces `UTable`; this is the reading every history and
list table in the estate re-derived by hand: a sticky header, column groups with
their unit drawn once, right-aligned tabular numerals, one missing-value style,
day (group) rows, a sticky first column, a phone column-set switch, the “no
value, sorted last” break row, and a loading reading that keeps the rows on
screen.

**It never reorders rows.** Sorting belongs to whoever owns the set — the
server, through `useCollection().setSort`. The table draws the arrow,
`aria-sort` and the column tint for `sort`, emits `update:sort` on a header
click, and renders `rows` in the order they arrived. A table that sorted the 25
rows it holds is exactly the “Wind ↓ sorts one page” bug the buoys round-2 board
opens with.

Group and break rows are extra entries in the data handed to `UTable`: their
first cell spans every column and the remaining cells are `hidden`, so the
markup stays one `<tr>` per line and TanStack still owns the body.

#### Example

```vue
<script setup lang="ts">
const columns = [
  { key: 'time', label: 'Time', sticky: true },
  {
    key: 'wind',
    label: 'avg',
    group: 'wind',
    numeric: true,
    emphasis: true,
    sortKey: 'wind',
    firstDirection: 'desc',
  },
  { key: 'gust', label: 'gust', group: 'wind', numeric: true },
  { key: 'pressure', label: 'sea level', group: 'pressure', numeric: true },
]
const groups = [
  { id: 'wind', label: 'Wind', unit: 'kt' },
  { id: 'pressure', label: 'Pressure', unit: 'inHg' },
]
</script>

<template>
  <NeDataTable
    :columns="columns"
    :groups="groups"
    :rows="c.items"
    :group-by="(row) => row.day"
    :sort="c.sort"
    :loading="c.pending"
    v-model:column-set="columnSet"
    @update:sort="c.setSort"
  />
</template>
```

#### Props

| Prop               | Type                      | Default     | Notes                                                                                                            |
| ------------------ | ------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `columns`          | `NeDataColumn<T>[]`       | —           | Required. See the column contract below.                                                                         |
| `rows`             | `T[]`                     | —           | Required. Drawn in this order.                                                                                   |
| `groups`           | `NeDataColumnGroup[]`     | `[]`        | Header row above grouped columns. Each group’s `unit` is drawn once.                                             |
| `rowKey`           | `(row, index) => string`  | index       | Stable row identity.                                                                                             |
| `groupBy`          | `(row) => string \| null` | —           | Opens a group (day) row whenever the key changes. Rows must already be in order.                                 |
| `groupLabel`       | `(key, rows) => string`   | the key     | The group row’s text. The `group` slot overrides it.                                                             |
| `sort`             | `string \| null`          | `null`      | Wire form (`'wind:desc'`). Drives the arrow, `aria-sort` and the column tint.                                    |
| `missingLast`      | `boolean`                 | `true`      | Draws a break row before the first row with no value in the sorted column.                                       |
| `missingCount`     | `number \| null`          | page count  | The whole set’s count of rows with no value, for the break row’s text.                                           |
| `missingLabel`     | `string`                  | —           | Replaces the break row’s text entirely.                                                                          |
| `missingText`      | `string`                  | —           | What every missing cell reads (`'unreported'`), as visible dimmed text. Unset keeps the em dash.                 |
| `loading`          | `boolean`                 | `false`     | Dims the rows under a 2 px bar. The rows stay; nothing jumps.                                                    |
| `dropEmptyColumns` | `boolean`                 | `false`     | Drops a non-sticky column whose every row is missing.                                                            |
| `columnSet`        | `string \| null`          | first group | On a phone, which group shows beside the sticky and ungrouped columns. `v-model:column-set`.                     |
| `phoneColumnSets`  | `boolean`                 | 2+ groups   | The phone column-set switch. Defaults to on when there are two or more groups.                                   |
| `stickyHeader`     | `boolean \| 'page'`       | `true`      | `true`: sticks inside the table’s scroll box. `'page'`: sticks under the site header. `false`: no sticky header. |
| `empty`            | `string`                  | `'No rows'` | Text for a table with no rows.                                                                                   |
| `caption`          | `string`                  | —           | Screen-reader caption.                                                                                           |

#### Column contract (`NeDataColumn`)

| Field            | Type                        | Notes                                                                                      |
| ---------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `key`            | `string`                    | Column id, and the property read when `value` is not given.                                |
| `label`          | `string`                    | Header text.                                                                               |
| `unit`           | `string`                    | Drawn in the header under the label; cells then carry numbers only.                        |
| `group`          | `string`                    | A `NeDataColumnGroup.id`. Ungrouped columns sit outside every group.                       |
| `numeric`        | `boolean`                   | Right-aligned, tabular, monospaced numerals (`font-mono tabular-nums`).                    |
| `emphasis`       | `boolean`                   | The group’s headline value, drawn at `font-medium`.                                        |
| `sticky`         | `boolean`                   | Pinned to the left edge, and never hidden by the phone column-set switch.                  |
| `width`          | `string`                    | Any CSS length, set on the header cell. See “Overflow and column widths” below.            |
| `value`          | `(row) => unknown`          | How to read the cell. Defaults to `row[key]`.                                              |
| `format`         | `(value, row) => string`    | How to print a present value. Missing values never reach it.                               |
| `missingText`    | `string \| (row) => string` | What a missing cell in this column reads. Overrides the table’s `missingText`.             |
| `sortKey`        | `string`                    | Makes the header a `NeSortHeader` for this wire key. The table never reorders rows itself. |
| `firstDirection` | `'asc' \| 'desc'`           | First-click direction for `sortKey`. Defaults to `'asc'`.                                  |
| `csv`            | `false \| (row) => unknown` | `false` leaves the column out of `NeCsvDownload`; a function supplies the raw file value.  |
| `csvLabel`       | `string`                    | CSV header text. Defaults to `label (unit)`.                                               |
| `csvOnly`        | `boolean`                   | In the CSV only — e.g. the SI twin of a displayed column.                                  |

`0` and `false` are values. `null`, `undefined`, `''` and a non-finite number
are missing: an em dash in `text-dimmed` with “No value” for a screen reader,
never `0`. Set `missingText` on the table, or on a column, to make a missing
cell read as a word instead (“unreported”, “unset”, “not claimed”): it is drawn
as visible `text-dimmed` text, so sighted readers and screen readers get the
same word. A column's `missingText` can be a function of the row.

#### Slots and events

| Slot         | Props                    | Notes                           |
| ------------ | ------------------------ | ------------------------------- |
| `group`      | `{ key, rows }`          | Replaces the group row’s label. |
| `break`      | `{ column, count }`      | Replaces the break row’s text.  |
| `<key>-cell` | `{ column, row, value }` | Custom cell for that column.    |

The slots are declared (`NeDataTableSlots<T>`), so `vue-tsc` and
`nuxt typecheck` accept a `<key>-cell` template and type its `row` as the
table's row type — no local typed wrapper needed:

```vue
<NeDataTable :columns="columns" :rows="stations">
  <template #status-cell="{ row }">
    <NeStatusBadge :tone="row.online ? 'ok' : 'error'" :label="row.online ? 'Online' : 'Offline'" />
  </template>
</NeDataTable>
```

| Event              | Payload  | Notes                                                   |
| ------------------ | -------- | ------------------------------------------------------- |
| `update:sort`      | `string` | Next wire sort (`'wind:desc'`). Hand it to `c.setSort`. |
| `update:columnSet` | `string` | The phone switch picked a different group.              |

#### Phone column sets

On a narrow viewport the table cannot show every group beside the sticky
columns. With two or more groups a `UTabs` switch (`data-ne-column-sets`) picks
which group shows; sticky and ungrouped columns stay. The hidden groups carry
`max-sm:hidden`, so the server renders every column and CSS hides the rest — no
viewport is consulted. `stickyHeader="page"` pairs with this: the box no longer
scrolls sideways.

#### Overflow and column widths

The table owns its sideways overflow
([narduk-libs#684](https://github.com/narduk-enterprises/narduk-libs/issues/684),
proven in operator-portal’s `CollectionTable`). `UTable`’s root is the table’s
scroll box (`data-ne-data-table-scroll`, `overflow-auto`), and both it and the
outer `[data-ne-data-table]` carry `min-w-0 max-w-full`. One long unbreakable
string — a hostname, a SHA — scrolls the box, never the page, including when the
table sits in a flex or grid parent that would otherwise grow to fit it.

A column may declare a `width` (`'6rem'`, `'120px'`); leave the column that
should take the slack width-less. A cell ignores `min-width`, so fixed-width
columns would hand a width-less one only what they leave over (146–191 px on a
1024 px iPad in operator-portal, rows wrapped thousands of pixels tall). The
floor is therefore on the **table**, not the cell: once any shown column
declares a width, the scroll box gets
`--ne-data-table-min: calc(<each width, or 200px for a width-less column> + …)`
inline and the `<table>` takes `min-width: max(100%, var(--ne-data-table-min))`.
Every width-less column is floored, not only the first, and the box scrolls
sideways when the container is narrower.

- No floor when no column declares a width (nothing squeezes a column, and a
  table written before `width` renders exactly as it did), and none when every
  column declares one (the widths already are the floor).
- The floor applies from `sm` up. Below `sm` the phone column-set switch hides
  groups the sum still counts, so the table stays `min-w-full` there and a phone
  is never forced to scroll by the floor alone.
- `stickyHeader="page"` gives up the scroll box — a scroll box would pin the
  header to itself instead of the page — and with it the floor, which is only
  safe inside one. Pair it with the phone column-set switch, and keep its cells
  short.

#### Loading

`loading` keeps the current rows, dims the body (`opacity-50`) and draws a 2 px
bar on the header (`after:h-0.5`). The wrapper carries `aria-busy="true"`.
Nothing is replaced with a skeleton, so the table does not jump.

#### Types

```ts
import type {
  NeDataColumn,
  NeDataColumnGroup,
  NeDataTableCellSlotProps,
  NeDataTableProps,
  NeDataTableSlots,
} from '@narduk-enterprises/narduk-shell'
```

### NeSortHeader

A sortable column header
([narduk-libs#528](https://github.com/narduk-enterprises/narduk-libs/issues/528)),
promoted from stonx’s `SortableTableHeader.vue`. First click picks the useful
way — readings strongest first (`firstDirection="desc"`), names A–Z (`'asc'`).
The second click flips it. There is no third, “unsorted” click; a Reset control
outside the table does that.

Two call shapes:

- **Server mode.** `sortKey` + `sort` (wire form, `'wind:desc'`) emit
  `update:sort`, which is what `useCollection().setSort` takes. The header never
  reorders rows; the server does. This is what `NeDataTable` uses.
- **Client mode.** A TanStack `column` from a plain `UTable` `#<id>-header`
  slot, exactly the stonx call shape, so those sites move over unchanged.

`aria-sort` belongs on the `<th>`, not on the button inside it. `UTable` gives a
header slot no way to set attributes on its cell, so the header writes
`aria-sort` onto its closest `<th>` after mount and removes it when the column
stops being sorted. At rest a column carries no `aria-sort` at all. The column
tint is the table’s business: `NeDataTable` draws `bg-elevated/50` down the
sorted column.

#### Example

```vue
<NeSortHeader
  label="Wind"
  unit="kt"
  sort-key="wind"
  first-direction="desc"
  align="end"
  :sort="c.sort"
  @update:sort="c.setSort"
/>
```

#### Props

| Prop             | Type               | Default   | Notes                                                                |
| ---------------- | ------------------ | --------- | -------------------------------------------------------------------- |
| `label`          | `string`           | —         | Required. The header text.                                           |
| `unit`           | `string`           | —         | Shown once, muted, beside the label: `kt`, `°F`.                     |
| `firstDirection` | `'asc' \| 'desc'`  | `'asc'`   | Which way the first click sorts.                                     |
| `align`          | `'start' \| 'end'` | `'start'` | `'end'` for a numeric column, so the arrow sits against the numbers. |
| `sortKey`        | `string`           | —         | Server mode: the key this header sorts by.                           |
| `sort`           | `string \| null`   | `null`    | Server mode: the current sort in wire form (`useCollection().sort`). |
| `column`         | `NeSortableColumn` | —         | Client mode: a TanStack column from a `UTable` header slot.          |

#### Events

| Event         | Payload  | Notes                                                                                          |
| ------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `update:sort` | `string` | Server mode only. `'<sortKey>:<asc\|desc>'`. Client mode calls `column.toggleSorting` instead. |

`parseSort` is a package-root export: `'wind:desc'` → `{ key, direction }`,
anything else → `null`. Use it when a page reads a wire sort without a regex.

#### Types

```ts
import { parseSort } from '@narduk-enterprises/narduk-shell'
import type {
  NeSortDirection,
  NeSortHeaderProps,
  NeSortableColumn,
} from '@narduk-enterprises/narduk-shell'
```

### NeCsvDownload

“CSV” for exactly the rows in view
([narduk-libs#528](https://github.com/narduk-enterprises/narduk-libs/issues/528)).
Hand it the same `columns` and `rows` the `NeDataTable` beside it draws and it
writes those rows, in that order — not the whole history, not the next page.
Columns with `csv: false` stay out; `csvOnly` columns (an SI twin of a displayed
column, say) go in. Values are written raw through each column’s `csv` accessor
or `value`, never through `format`, so a spreadsheet gets numbers rather than
“12 kt”. Missing values are empty cells, never `0`.

`preamble` lines go above the header — the place for an attribution line. The
text itself is `toCsv()`, exported from the package root, so a server route can
produce the identical file. The button is inert on the server: it only builds
the file when it is clicked, in the browser.

#### Example

```vue
<NeCsvDownload
  :columns="columns"
  :rows="c.items"
  :preamble="['Source: NOAA NDBC']"
  filename="history"
/>
```

```ts
import { toCsv } from '@narduk-enterprises/narduk-shell'

const csv = toCsv(columns, rows, ['Source: NOAA NDBC'])
```

#### Props

| Prop       | Type                   | Default        | Notes                                        |
| ---------- | ---------------------- | -------------- | -------------------------------------------- |
| `columns`  | `NeDataColumn<T>[]`    | —              | Required. Same contract as `NeDataTable`.    |
| `rows`     | `T[]`                  | —              | Required. Exactly these rows, in this order. |
| `filename` | `string`               | `'export.csv'` | `.csv` is appended when missing.             |
| `preamble` | `readonly string[]`    | `[]`           | Lines written above the header.              |
| `label`    | `string`               | `'CSV'`        | The button’s text.                           |
| `size`     | `'xs' \| 'sm' \| 'md'` | `'sm'`         | Nuxt UI button size.                         |

#### Events

| Event      | Payload                   | Notes                                       |
| ---------- | ------------------------- | ------------------------------------------- |
| `download` | `[csv: string, filename]` | Fired with the same text the file contains. |

Formula-leading text (`=`, `+`, `-`, `@`) is prefixed so a spreadsheet does not
run it; numeric cells are written as numbers, so a negative reading is never
prefixed.

#### Types

```ts
import { toCsv } from '@narduk-enterprises/narduk-shell'
import type { NeCsvDownloadProps } from '@narduk-enterprises/narduk-shell'
```

### NeForm

Wraps Nuxt UI's `UForm` with a save bar that does not lie. Components backlog
item 19
([narduk-libs#266](https://github.com/narduk-enterprises/narduk-libs/issues/266)),
closing three named bug classes by construction rather than by caller
discipline:

- **Double-submit (stonx#37).** Two rapid submits — a fast double-click, or
  Enter held a beat too long — issue exactly **one** `onSubmit` call. A
  capture-phase `submit` listener on a real DOM ancestor of `UForm`'s `<form>`
  drops any second submit while the first is still in flight, before `UForm`
  itself ever sees it: no second validate, no second `dirtyFields.clear()`
  landing early and flipping the save bar to "saved" while the first save is
  still pending.
- **A save bar that lies about dirtiness (stonx#36).** `Unsaved changes` is
  driven by `UForm`'s own `dirty` state, which only clears once `onSubmit`'s
  promise _resolves_. A rejected save leaves it dirty — there is no optimistic
  "saved" flash to walk back on failure.
- **Errors that do not scroll into view (stonx#350).** A schema (or `validate`)
  failure blocks submission and moves focus to the first invalid field, scrolled
  into view, rather than leaving the reviewer to hunt for which one broke.

`UButton`'s own `loading-auto` is what makes the save button spin and disable
itself for exactly the duration of the `onSubmit` promise — no ref to wire
between this component and its button.

#### Example

```vue
<NeForm :state="profile" :on-submit="saveProfile">
  <UFormField name="name" label="Name">
    <UInput v-model="profile.name" />
  </UFormField>
</NeForm>
```

#### Props

| Prop         | Type                                    | Default  | What it does                                                                                                                                            |
| ------------ | --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`      | `Record<string, unknown>`               | —        | Required. The form's reactive state — there is no uncontrolled mode.                                                                                    |
| `onSubmit`   | `(data) => unknown \| Promise<unknown>` | —        | Called with the validated data. Bind as `:on-submit`, a real prop, not `@submit`.                                                                       |
| `schema`     | `unknown`                               | —        | A Standard Schema object (zod, valibot, …) or any of `UForm`'s own accepted shapes.                                                                     |
| `validate`   | `(state) => unknown`                    | —        | Custom validation, forwarded to `UForm`'s own `validate` prop. An alternative to `schema`.                                                              |
| `saveLabel`  | `string`                                | `'Save'` | Label for the save button.                                                                                                                              |
| `disabled`   | `boolean`                               | `false`  | Disables every field and the save button, in addition to the loading state.                                                                             |
| `stickySave` | `boolean`                               | `false`  | Renders the save bar `position: sticky` at the bottom of its scrolling ancestor. `NeSettingsPage` turns this on; a standalone `NeForm` defaults it off. |

#### Slots

| Slot      | When it renders                                                 |
| --------- | --------------------------------------------------------------- |
| `default` | The form's fields — typically one or more `NeFormSection`s.     |
| `actions` | Extra buttons in the save bar, rendered before the save button. |

#### Events

None. `onSubmit` is a real function prop (matching `UForm`'s own contract), not
a `defineEmits` listener, so its return value can be awaited directly the same
way `UForm` awaits its own `onSubmit` and `UButton` awaits its own `onClick`.

#### Binding a schema

```vue
<script setup lang="ts">
import { z } from 'zod'

const schema = z.object({ name: z.string().min(1, 'Name is required') })
const state = reactive({ name: '' })
</script>

<template>
  <NeForm :schema="schema" :state="state" :on-submit="save">
    <UFormField name="name" label="Name">
      <UInput v-model="state.name" />
    </UFormField>
  </NeForm>
</template>
```

A failing field is focused automatically — no `ref` or manual `scrollIntoView`
call needed at the call site.

### NeFormSection

A titled group of fields inside a `NeForm` — a thin wrapper around
`NeSectionHeader` (title, description, actions) plus a fields slot below it. It
renders no `<form>` of its own and does not touch validation or submission:
those stay owned by the enclosing `NeForm`'s `UForm`, which validates against
the whole `state`/`schema` regardless of how the fields inside it are grouped
visually. Splitting a long settings page into sections is purely presentational.

#### Example

```vue
<NeFormSection title="Profile" description="Your public account details.">
  <UFormField name="name" label="Name">
    <UInput v-model="state.name" />
  </UFormField>
</NeFormSection>
```

#### Props

| Prop          | Type                                           | Default | What it does                                                                                                  |
| ------------- | ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `title`       | `string`                                       | —       | Required. The section title.                                                                                  |
| `description` | `string`                                       | —       | Supporting copy shown below the title.                                                                        |
| `as`          | `'h1' \| 'h2' \| 'h3' \| 'h4' \| 'h5' \| 'h6'` | `'h3'`  | The heading tag. Defaults one level below `NeSettingsPage`'s own `h1` and a typical `NeSectionHeader`'s `h2`. |

#### Slots

| Slot      | When it renders                                             |
| --------- | ----------------------------------------------------------- |
| `default` | The section's fields — typically one or more `UFormField`s. |
| `actions` | Right-aligned actions next to the section title.            |

#### Events

None.

### NeSettingsPage

A full settings screen: `NePageHeader` on top of a `NeForm` whose save bar is
sticky by default, so the save action stays reachable on a page built from
several `NeFormSection`s stacked below the fold. This is composition, not new
behaviour — every `NeForm` bug fix (double-submit, honest dirty state,
focus-on-error) is inherited unchanged; `NeSettingsPage` only wires
`NePageHeader`'s title/description to the page and forces `stickySave` on.

#### Example

```vue
<NeSettingsPage
  title="Settings"
  :schema="schema"
  :state="state"
  :on-submit="save"
>
  <NeFormSection title="Profile">
    <UFormField name="name">
      <UInput v-model="state.name" />
    </UFormField>
  </NeFormSection>
</NeSettingsPage>
```

#### Props

| Prop          | Type                                    | Default  | What it does                                                   |
| ------------- | --------------------------------------- | -------- | -------------------------------------------------------------- |
| `title`       | `string`                                | —        | Required. The page title, rendered by `NePageHeader`.          |
| `state`       | `Record<string, unknown>`               | —        | Required. Forwarded to `NeForm`'s `state` prop.                |
| `description` | `string`                                | —        | Forwarded to `NePageHeader`.                                   |
| `onSubmit`    | `(data) => unknown \| Promise<unknown>` | —        | Forwarded to `NeForm`'s `onSubmit` prop. Bind as `:on-submit`. |
| `schema`      | `unknown`                               | —        | Forwarded to `NeForm`'s `schema` prop.                         |
| `validate`    | `(state) => unknown`                    | —        | Forwarded to `NeForm`'s `validate` prop.                       |
| `saveLabel`   | `string`                                | `'Save'` | Forwarded to `NeForm`.                                         |
| `disabled`    | `boolean`                               | `false`  | Forwarded to `NeForm`.                                         |

There is no `stickySave` prop: `NeSettingsPage` always renders a sticky save
bar, which is the entire reason to reach for it over a standalone `NeForm`.

#### Slots

| Slot            | When it renders                                                                       |
| --------------- | ------------------------------------------------------------------------------------- |
| `default`       | The page's fields — typically one or more `NeFormSection`s.                           |
| `actions`       | Extra buttons in the save bar, rendered before the save button.                       |
| `headerActions` | Right-aligned actions next to the page title, distinct from the save bar's `actions`. |

#### Events

None, for the same reason as `NeForm`: `onSubmit` is a real function prop.

#### Supersedes

`narduk-core`'s `AppSettingsProfile` (D4, Logan 2026-09-11: "Deprecate, remove
next major"). It is deprecated in the same release as this component and removed
in the next `narduk-core` major; the migration mapping is in
[that package's README](../../modules/narduk-core/README.md#deprecated-components).

### NeKpiTile

One measured metric in a `UCard`: a label, a value, and an optional signed delta
with a caption. The value and the delta are formatted through the `./format`
subpath's `formatNumber` (item 5,
[narduk-libs#252](https://github.com/narduk-enterprises/narduk-libs/issues/252)),
never with `Number.prototype.toLocaleString` — the fixed `en-US` locale is what
lets the server and the browser render the same digits on the first paint.

#### Example

```vue
<NeKpiTile
  label="Runners online"
  :value="128"
  :delta="6"
  tone="ok"
  detail="vs yesterday"
/>
```

#### Props

| Prop           | Type                                    | Default     | What it does                                                                                                                                                                                                                                                                                      |
| -------------- | --------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`        | `string`                                | —           | The metric's name, shown above the value.                                                                                                                                                                                                                                                         |
| `value`        | `number \| string \| null \| undefined` | —           | A `number` is formatted with `formatNumber`; a `string` is a caller-formatted value (`formatMoney`, `formatPercent`, …) rendered as-is; `null`/`undefined` (or a non-finite number) render the [unreported treatment](#the-unreported-treatment): `—` on `--ne-hatch-soft`, named "Not reported". |
| `valueOptions` | `NeNumberOptions`                       | `undefined` | Forwarded to `formatNumber` when `value` is a `number`. Ignored for a string value.                                                                                                                                                                                                               |
| `delta`        | `number \| string \| null`              | `undefined` | Change since a prior period. A `number` gets `signDisplay: 'always'` and a ▲/▼ direction glyph; a `string` renders as-is with no glyph. Omit entirely when there is nothing to compare against.                                                                                                   |
| `deltaOptions` | `NeNumberOptions`                       | `undefined` | Forwarded to `formatNumber` when `delta` is a `number`. Ignored for a string delta.                                                                                                                                                                                                               |
| `detail`       | `string`                                | `''`        | Caption next to the delta, e.g. `"vs last week"`.                                                                                                                                                                                                                                                 |
| `tone`         | `NeStatusTone`                          | `undefined` | Colours the delta only. Never changes what the delta says, and says nothing about `value` itself. Defaults to `text-muted`.                                                                                                                                                                       |

Tone → colour, the same vocabulary `NeStatusBadge` uses:

| Tone      | Delta colour   |
| --------- | -------------- |
| `ok`      | `text-success` |
| `warn`    | `text-warning` |
| `error`   | `text-error`   |
| `info`    | `text-info`    |
| `neutral` | `text-muted`   |
| `pending` | `text-muted`   |

#### Slots

| Slot    | When it renders                                                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spark` | Under the value and delta, when given — e.g. a `narduk-charts` sparkline. `NeKpiTile` never imports `narduk-charts` itself; composing one in is the caller's job. |

#### Accessibility

Colour is never the only signal for a delta's direction: the rendered text
always carries an explicit sign (`formatNumber`'s `signDisplay: 'always'`) and a
▲/▼ glyph, so the reading survives with every tone-driven colour class stripped
away. Glyph and number are one text node rather than an `aria-hidden` glyph span
beside a separate number — splitting them would leave the visible reading at the
mercy of how the template compiler treats the whitespace between the two, and
the sign alone already carries the direction with no glyph at all.
`test/NeKpiTile.mount.test.ts` proves the delta text is identical across every
tone.

An unreported value — `null`, `undefined` or a non-finite number — is an em-dash
inside `role="img"` named "Not reported", on the soft hatch, with
`data-state="unreported"` on the value's `<dd>`. A reported `0` stays a plain
`0`. Pass the API's `null` through rather than defaulting it to `0`; see
[The unreported treatment](#the-unreported-treatment).

`NeNumberOptions` is the `./format` subpath's own type
(`import type { NeNumberOptions } from '@narduk-enterprises/narduk-shell/format'`).

### NeKpiBand

A responsive grid of `NeKpiTile`s. It lays out; it does not style the tiles
inside it — no card, border or background of its own, just `display: grid` and a
gap.

#### Example

```vue
<NeKpiBand :columns="{ base: 1, sm: 2, lg: 4 }">
  <NeKpiTile label="Runners online" :value="128" :delta="6" tone="ok" />
  <NeKpiTile label="Open findings" :value="42" :delta="-3" tone="error" />
</NeKpiBand>
```

#### Props

| Prop      | Type                                                                        | Default       | What it does                                                                                                          |
| --------- | --------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `columns` | `Partial<Record<'base' \| 'sm' \| 'md' \| 'lg' \| 'xl', 1\|2\|3\|4\|5\|6>>` | `{ base: 1 }` | Columns per breakpoint. Only the breakpoints given are constrained; an app's own responsive design fills in the rest. |

Every `grid-cols-*` class this component could ever apply is a literal string in
`src/runtime/components/NeKpiBand.vue`, not a computed `` `grid-cols-${n}` `` —
Tailwind's build-time scanner only ships a utility whose class name it can see
literally in source, so a name assembled at runtime never reaches the compiled
CSS.

#### Slots

| Slot      | When it renders                                    |
| --------- | -------------------------------------------------- |
| `default` | The tiles (or anything else) laid out in the grid. |

### NeCard

One entity card wrapping Nuxt UI's `UCard`. Backlog item 17
([narduk-libs#264](https://github.com/narduk-enterprises/narduk-libs/issues/264)).
Media, title, badge, stat rows, actions. Numbers go through the `./format`
subpath (`formatNumber`, or `formatQuantity` when a `unit` is set), never
`toLocaleString`. A missing stat is the formatter empty placeholder (`—`),
not 0.

The badge is `NeStatusBadge`: a string is a neutral chip, `{ label, tone }` is
what `defineStatusMap` already returns. Colour is never the only signal — the
badge's accessible name includes the tone.

#### Example

```vue
<NeCard
  title="Des Plaines at Riverside"
  :badge="{ label: 'Action', tone: 'warn' }"
  :stats="[
    { label: 'Stage', unit: 'foot', value: 5.2 },
    { label: 'Flow', unit: 'cfs', value: 1234 },
  ]"
>
  <template #actions>
    <UButton label="Open" />
  </template>
</NeCard>
```

#### Props

| Prop       | Type                                              | Default | Notes                                                                                |
| ---------- | ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `title`    | `string`                                          | `''`    | The card's name. The `#title` slot overrides it.                                     |
| `badge`    | `string \| { label: string; tone: NeStatusTone }` | —       | Status chip opposite the title. A string is a neutral label.                         |
| `media`    | `string`                                          | `''`    | Image URL. Prefer the `#media` slot for anything else.                               |
| `mediaAlt` | `string`                                          | `''`    | Accessible name of `media`. Falls back to `title`.                                   |
| `stats`    | `readonly NeCardStat[]`                           | `[]`    | Measured rows. A `number` is formatted; a `string` is rendered as-is; `null` is `—`. |

#### Slots

| Slot      | When it renders                                 |
| --------- | ----------------------------------------------- |
| `title`   | Replaces the title text.                        |
| `badge`   | Replaces the badge chip.                        |
| `media`   | Replaces the `<img>` when `media` is not a URL. |
| `default` | Body under the stats.                           |
| `actions` | Trailing controls, in `UCard`'s footer.         |

#### Types

```ts
import type {
  NeCardBadge,
  NeCardProps,
  NeCardStat,
} from '@narduk-enterprises/narduk-shell'
```

### NeCardList

The card reading of the same collection a table draws. Bind `v-model:state` or
`:collection` — both are the `useCollection()` snapshot `NePager` already takes
— so one page toggles cards and table without a second fetch. `NeStatePanel` and
`NePager` are built in.

Empty, loading and error are the panel's contract, and only when there is
nothing to show. A collection keeps the last good page on a later error or a
refetch; drawing a panel over those cards would hide the rows the reader already
has. The built-in pager sits beside the panel, not inside it: `NeStatePanel`
only renders its default slot when there is no reading, so a pager in that slot
would disappear on an empty first paint, a loading fetch with no rows yet, or an
error with no cached page.

`columns` picks the Tailwind `grid-cols-*` utility per breakpoint the same way
`NeKpiBand` does. Every class this component could apply is a literal string in
`src/runtime/components/NeCardList.vue`, not a computed `` `grid-cols-${n}` ``.

#### Example

```vue
<script setup lang="ts">
const c = useCollection({ fetch })
const mode = ref<'cards' | 'table'>('cards')
</script>

<template>
  <NeCardList
    v-if="mode === 'cards'"
    :collection="c"
    :card="RiverCard"
    :columns="{ base: 1, md: 2, xl: 3 }"
    noun="rivers"
  />
  <template v-else>
    <NeDataTable :columns="columns" :rows="c.items" />
    <NePager v-model:state="c.state" noun="rivers" />
  </template>
</template>
```

The `#card` slot is the other form, when the card needs more than `item`:

```vue
<NeCardList :collection="c" noun="rivers">
  <template #card="{ item }">
    <NeCard :title="item.name" :stats="[{ label: 'Stage', unit: 'foot', value: item.stage }]" />
  </template>
</NeCardList>
```

#### Props

| Prop             | Type                                                                        | Default                     | Notes                                                                                             |
| ---------------- | --------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `collection`     | `NeCollection<T>`                                                           | —                           | The live `useCollection()` return. Wins over `v-model:state` when both are given.                 |
| `card`           | `Component`                                                                 | —                           | Per-item component. Receives the row as `item`. Prefer `#card` when more than one prop is needed. |
| `columns`        | `Partial<Record<'base' \| 'sm' \| 'md' \| 'lg' \| 'xl', 1\|2\|3\|4\|5\|6>>` | `{ base: 1, md: 2, xl: 3 }` | Columns per breakpoint.                                                                           |
| `noun`           | `string`                                                                    | `'results'`                 | Plural noun for the built-in pager summary.                                                       |
| `density`        | `'default' \| 'dense'`                                                      | `'default'`                 | Forwards to `NePager`.                                                                            |
| `mode`           | `'pages' \| 'more' \| 'auto'`                                               | `'pages'`                   | Forwards to `NePager`.                                                                            |
| `pageSizes`      | `readonly number[]`                                                         | —                           | Forwards to `NePager`.                                                                            |
| `maxLimit`       | `number`                                                                    | —                           | Forwards to `NePager`.                                                                            |
| `to`             | `(page: number) => RouteLocationRaw`                                        | —                           | Forwards to `NePager`. Real hrefs.                                                                |
| `rowKey`         | `(item: T, index: number) => string`                                        | index                       | Stable identity for each card.                                                                    |
| `emptyTitle`     | `string`                                                                    | `''`                        | Empty-panel headline.                                                                             |
| `emptyMessage`   | `string`                                                                    | `''`                        | Empty-panel sentence.                                                                             |
| `loadingTitle`   | `string`                                                                    | `''`                        | Loading-panel headline.                                                                           |
| `loadingMessage` | `string`                                                                    | `''`                        | Loading-panel sentence.                                                                           |
| `errorTitle`     | `string`                                                                    | `''`                        | Error-panel headline.                                                                             |
| `errorMessage`   | `string`                                                                    | `''`                        | Error-panel sentence. The collection's `error` is not stringified onto the page.                  |

`v-model:state` is `NeCollectionState<T>`. Assigning to it applies `page` only
when the parent is `useCollection`. Page-size and “Show more” emit
`update:limit` — the same event standalone `NePager` emits. Wire it to
`useCollection().setLimit` when you bind `v-model:state` without `:collection`;
otherwise the select and “Show more” silently no-op. When `:collection` is
bound, the list forwards that event to `collection.setLimit` itself.

```vue
<NeCardList
  v-model:state="c.state"
  noun="rivers"
  :page-sizes="[25, 50, 100]"
  @update:limit="c.setLimit"
>
  <template #card="{ item }">
    <NeCard :title="item.name" />
  </template>
</NeCardList>
```

#### Events

| Event          | Payload                | Notes                                                                                                                                    |
| -------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `update:state` | `NeCollectionState<T>` | The current state with a new `page`. Emitted only when the page actually changes.                                                        |
| `update:limit` | `number`               | A new page size. The page-size select and “Show more” emit this; the list never writes `limit` through `state`. Same event as `NePager`. |

#### Slots

| Slot   | When it renders                                                                  |
| ------ | -------------------------------------------------------------------------------- |
| `card` | One card. Slot props: `{ item, index }`. Preferred over `:card` for composition. |

#### Types

```ts
import type {
  NeCardListBreakpoint,
  NeCardListColumnCount,
  NeCardListProps,
} from '@narduk-enterprises/narduk-shell'
```

### NeDetailView

A key-value panel: label, value, `format`, `unit`, and an unavailable sentence
for a missing reading. Backlog item 17
([narduk-libs#264](https://github.com/narduk-enterprises/narduk-libs/issues/264)).

Numbers and dates go through `./format`. A `date` / `datetime` row without an
explicit zone (row or panel) is treated as unavailable rather than rendered in
the host time zone — that is the hydration class item 5 exists to remove.
`relative` is not a format here: it needs a caller-supplied `now`. Format that
string at the call site and pass it as a pre-formatted value.

#### Example

```vue
<NeDetailView
  :items="[{ label: 'Stage', value: stage, format: 'quantity', unit: 'ft' }]"
  unavailable-message="No reading"
/>
```

#### Props

| Prop                 | Type                      | Default                           | Notes                                                                                             |
| -------------------- | ------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `items`              | `readonly NeDetailItem[]` | —                                 | Required. Each row is a label, a value, and optional `format` / `unit` / `currency` / `timeZone`. |
| `unavailableMessage` | `string`                  | formatter empty placeholder (`—`) | What a missing reading prints.                                                                    |
| `timeZone`           | `string`                  | —                                 | IANA zone for every `date` / `datetime` row that does not set its own.                            |

#### `NeDetailItem`

| Field      | Type                                      | Notes                                                                                               |
| ---------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `label`    | `string`                                  | Required. Always visible, so the row never depends on colour.                                       |
| `value`    | `NeDateInput \| number \| string \| null` | `null` / `undefined` / a non-finite number render the unavailable message.                          |
| `format`   | `NeDetailFormat`                          | `'number' \| 'compact' \| 'percent' \| 'money' \| 'quantity' \| 'date' \| 'datetime' \| 'duration'` |
| `unit`     | `string`                                  | Required for `format: 'quantity'`.                                                                  |
| `currency` | `string`                                  | Required for `format: 'money'`.                                                                     |
| `timeZone` | `string`                                  | Per-row override of the panel `timeZone`.                                                           |
| `empty`    | `string`                                  | Per-row override of `unavailableMessage`.                                                           |

#### Types

```ts
import type {
  NeDetailFormat,
  NeDetailItem,
  NeDetailViewProps,
} from '@narduk-enterprises/narduk-shell'
```

### NeMeter

One value against a known ceiling
([narduk-libs#601](https://github.com/narduk-enterprises/narduk-libs/issues/601)):
a filled track with the figure beside it — a rate-limit budget, a quota,
headroom against a plan. The figure reads `4,200 / 5,000`, formatted through
`./format`'s `formatNumber`, so the server and the browser print the same digits
on the first paint.

A value with no producer is **not** an empty bar. `:value="null"` (or
`undefined`, an omitted `value`, or a non-finite number) renders the
[unreported treatment](#the-unreported-treatment): the `--ne-hatch` track with
no fill, `— / 5,000` as the figure, and an accessible name ending "not
reported". A reported `0` is an empty track and the digit `0`; the two never
look alike.

It is a plain element with a scoped stylesheet of token reads, not a wrapped
Nuxt UI primitive. `UProgress` is the nearest one and fits neither half: it is a
`progressbar` (a task heading for completion), not a `meter` (a quantity inside
a known range), and its `null` value is the animated indeterminate state —
"working on it" — which is exactly the reading an unreported figure must not
give. The prior art is `narduk-ui`'s `NsRangeBar` and `NsLevelWell`; they read
the `--ns-*` layer and are not aliased here.

#### Example

```vue
<NeMeter :value="4200" :max="5000" label="Core REST" />
<NeMeter :value="headroom" :max="budget" variant="inline" />
<!-- Nothing reported yet: hatched, em-dash, "Search: not reported". -->
<NeMeter :value="null" :max="30" label="Search" />
```

#### Props

| Prop      | Type                  | Default   | What it does                                                                                                                                                                 |
| --------- | --------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `value`   | `number \| null`      | `null`    | The measured quantity. `null`/`undefined`/non-finite renders the unreported treatment. The fill is clamped to `[0, max]`; the figure always shows the real, unclamped value. |
| `max`     | `number`              | —         | The ceiling. Zero or less (or not finite) is a ceiling with no room: a reported `0` renders empty, anything above it renders full, and nothing divides by zero.              |
| `label`   | `string`              | `''`      | Shown beside the track and used as the accessible name. Without one, the meter is named by its own reading (`4,200 of 5,000`).                                               |
| `variant` | `'block' \| 'inline'` | `'block'` | `block`: label and figure on one line, the track full-width under them. `inline`: label, track and figure in one row, for a table cell or a list row.                        |

#### Slots

None. The figure is always `formatNumber(value) / formatNumber(max)`; a meter
that needs a different unit is a follow-up prop, not a slot.

#### Events

None. A meter reports; it is not a control.

#### Accessibility

A reported meter is `role="meter"` with `aria-valuemin="0"`, `aria-valuemax`,
`aria-valuenow` (the clamped value) and `aria-valuetext` (`"5,400 of 5,000"` —
the real reading, so an overrun is not announced as exactly full). An unreported
one has no value to give — ARIA requires `aria-valuenow` on a `meter`, and `0`
would be the lie this component exists to avoid — so it is `role="img"` named
`"<label>: not reported"` (or `NE_UNREPORTED_TEXT`, `"Not reported"`, with no
label). Both roles have presentational children, so the visible label and figure
are not read a second time. The root carries `data-state="reported"` or
`"unreported"`.

The track keeps the same footprint in both states, so a list of meters does not
reflow as figures arrive. Under forced colours the track keeps an outline and
the fill paints in `Highlight`.

#### Types

```ts
import {
  isUnreported,
  NE_UNREPORTED_TEXT,
} from '@narduk-enterprises/narduk-shell'
import type {
  NeMeterProps,
  NeMeterVariant,
} from '@narduk-enterprises/narduk-shell'
```

### NeProse

A markdown document rendered in the suite's type scale
([narduk-libs#1005](https://github.com/narduk-enterprises/narduk-libs/issues/1005)):
a runbook, a help page, a changelog entry. Body copy reads `--ne-text-body` at
`--ne-leading-body`, h2 the section-heading size (`--ne-text-heading`), h3 the
body size at weight 600, code and tables `--ne-text-small` and `--ne-font-mono`,
links `--ne-accent`.

The page header owns the page's h1, so **NeProse never renders an h1**: a `#`
heading is demoted to h2 (its text is kept, not dropped), and `####`–`######`
clamp to h3. Every heading carries a slug `id` — GitHub's rule: lowercase,
punctuation dropped, spaces to `-`, repeats suffixed `-1`, `-2` — so a table of
contents can link to `#install`. `parseProse()` and `proseOutline()` are
exported from the package root, so a page parses once and builds its TOC from
the same AST it renders.

It is XSS-safe by construction, not by sanitising. There is no `v-html` on the
path: `parseProse()` (a small pure parser in `src/runtime/utils/prose.ts`, no
dependency) produces a plain-data AST, and the component renders each node as an
element with the source text as text nodes. Raw HTML in the source is shown as
text. A link's `href` is the only attribute that carries source content, and it
is kept only when it is `http:`, `https:`, `mailto:` or has no scheme at all
(relative, `/root`, `#fragment`, `?query`); `javascript:`, `data:`, `vbscript:`
and every other scheme drop the anchor and keep the link text. The href is
checked again at render time, so a hand-built `blocks` AST gets the same rule.

#### The subset

| Construct             | Syntax                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Headings              | `#`–`######` (ATX, optional closing hashes) and `===` / `---` underlines                                                                    |
| Paragraphs and breaks | blank-line separated; two trailing spaces or a trailing `\` is a `<br>`                                                                     |
| Lists                 | `-` `*` `+` and `1.` / `1)`, nested by indentation, keeping an ordered start                                                                |
| Fenced code           | ` ``` ` or `~~~`, with the info string's first word as the language                                                                         |
| Tables                | GFM pipes with a `:--` / `:-:` / `--:` delimiter row                                                                                        |
| Blockquotes and rules | `>` (nesting any block) and `---` / `***` / `___`                                                                                           |
| Inline                | `` `code` ``, `**bold**` / `__bold__`, `*italic*` / `_italic_`, `[text](href)`, `<https://…>`, `<a@b.c>`, bare `https://` URLs, `\` escapes |

Deliberately left out: raw HTML (rendered as text), images (`![alt](src)`
renders its alt text), indented code blocks, reference-style links,
strikethrough, task lists and footnotes. A document that needs them wants a full
markdown pipeline, not this component.

#### Example

```vue
<script setup lang="ts">
import { parseProse, proseOutline } from '@narduk-enterprises/narduk-shell'

const props = defineProps<{ markdown: string }>()
const blocks = computed(() => parseProse(props.markdown))
const toc = computed(() =>
  proseOutline(blocks.value).filter((h) => h.level === 2),
)
</script>

<template>
  <NePageHeader title="Runbook" />
  <nav>
    <a v-for="entry in toc" :key="entry.id" :href="`#${entry.id}`">{{
      entry.text
    }}</a>
  </nav>
  <NeProse :blocks="blocks" />
  <!-- Or, with no TOC: <NeProse :source="markdown" /> -->
</template>
```

#### Props

| Prop     | Type             | Default     | What it does                                                                                                                                      |
| -------- | ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source` | `string`         | `''`        | The markdown to render, parsed with `parseProse()`.                                                                                               |
| `blocks` | `NeProseBlock[]` | `undefined` | A pre-parsed document — from `parseProse()` or built by hand — rendered as given (hrefs are still checked). Wins over `source` when both are set. |

#### Slots

None. The document is the content; a page that needs its own markup around a
section splits the document.

#### Events

None. A table of contents comes from `proseOutline()`, not from an event, so it
exists on the server's first paint too.

#### Helpers

- `parseProse(source: string): NeProseBlock[]` — the parser. Pure: no Vue, no
  DOM. Heading ids are unique within one call and stable for a given source.
- `proseOutline(input: string | NeProseBlock[]): NeProseHeading[]` — the
  document's top-level headings as `{ id, level, text }` in order (a heading
  inside a blockquote or list is not a section and is left out).

Two NeProse documents on one page share the document's id namespace; give the
second one headings that do not collide, or render it without a TOC.

#### Types

```ts
import { parseProse, proseOutline } from '@narduk-enterprises/narduk-shell'
import type {
  NeProseAlign,
  NeProseBlock,
  NeProseHeading,
  NeProseInline,
  NeProseListItem,
  NeProseProps,
} from '@narduk-enterprises/narduk-shell'
```

### NeAppShell

The application frame: a left rail of labelled sections, a navbar row, and the
page. Promoted from operator-portal's `app/layouts/default.vue` (plan decision
D2) and built on Nuxt UI's dashboard primitives — `UDashboardGroup`,
`UDashboardSidebar`, `UDashboardPanel`, `UDashboardNavbar` and one
`UNavigationMenu` per section.

- **Sections are labelled and always expanded.** Not a tree, not icon-only, and
  nothing collapses. The rail is one `nav` landmark (`navLabel`), and each
  section is a `role="group"` named by its label.
- **Active comes from the router.** Every item is a `to`; the item that lights
  is the one vue-router matches against the current route (the link's own active
  state, surfaced as `aria-current="page"` and `data-active`). A parent route
  stays active on its nested child routes. There is no `active` input.
- **The drawer exists only below the breakpoint.** At Nuxt UI's `lg` (1024px)
  and up the rail is a fixed 14.5rem column. Below it the rail is hidden and a
  toggle in the navbar row opens the same rail in a slide-over, which closes on
  navigation.
- **Arrow keys walk the rail.** With focus on a rail link, ArrowDown / ArrowUp
  move to the next / previous link across section boundaries, wrapping; Home /
  End go to the first / last. Focus only: every link stays in the Tab order and
  nothing navigates until Enter.
- **One `main`.** The page renders inside the shell's `<main>`, and a
  [`NeSkipLink`](#neskiplink) (visible on focus) moves focus to it.

The shell is **opt-in** (plan decision D3). The module registers the component
but no layout, and `create-narduk-app` scaffolds nothing: an app that wants it
writes it in its own layout. It does no auth and no route guarding.

#### Example

```vue
<!-- app/layouts/default.vue -->
<template>
  <NeAppShell nav-label="Portal">
    <template #rail-top>
      <AppWordmark />
    </template>
    <template #rail-bottom>
      <AccountMenu />
    </template>
    <template #navbar>
      <UBreadcrumb :items="crumbs" />
    </template>
    <template #navbar-right>
      <UButton
        icon="i-lucide-search"
        color="neutral"
        variant="ghost"
        aria-label="Search"
      />
    </template>

    <slot />
  </NeAppShell>
</template>
```

```ts
// nuxt.config.ts
nardukShell: {
  sections: [
    {
      id: 'operate',
      label: 'Operate',
      items: [
        { label: 'Overview', to: '/', icon: 'i-lucide-layout-dashboard' },
        { label: 'Runners', to: '/runners', icon: 'i-lucide-server', badge: 3 },
      ],
    },
    { id: 'settings', label: 'Settings', items: [{ label: 'Access', to: '/settings/access' }] },
  ],
}
```

#### Props

| Prop            | Type                           | Default             | Description                                                                                   |
| --------------- | ------------------------------ | ------------------- | --------------------------------------------------------------------------------------------- |
| `variant`       | `'rail'`                       | `'rail'`            | The shell's shape. `'rail'` is the only value today; reflected as `data-variant` on the root. |
| `sections`      | `readonly NeAppShellSection[]` | shared state        | The rail's sections. Omitted, the shell renders `useNardukShellSections()`.                   |
| `navLabel`      | `string`                       | `'Main'`            | The rail `nav`'s accessible name.                                                             |
| `skipLinkLabel` | `string`                       | `'Skip to content'` | Text of the skip link to the page's `<main>`.                                                 |

#### Slots

| Slot           | Description                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `default`      | The page, rendered inside the shell's `<main>`.                                                           |
| `rail-top`     | Top of the rail: the logo or app switcher. No header is drawn when empty.                                 |
| `rail-bottom`  | Bottom of the rail: the user / account control. No footer is drawn when empty.                            |
| `navbar`       | Left of the navbar row: breadcrumbs, a context line. The page's `h1` belongs to the page, not the navbar. |
| `navbar-right` | Right of the navbar row: search, page actions. With neither navbar slot, the row shows only below `lg`.   |

The rail slots render in the desktop column and again in the mobile slide-over
while it is open, so their content should not carry element ids.

#### Events

None.

#### `useNardukShellSections()`

Auto-imported. Returns the rail's sections as `Ref<NeAppShellSection[]>`: Nuxt
`useState`, so it is shared by every caller in a request, serialised into the
payload, and hydrated on the client without being re-seeded. It is seeded once
per request from `app.config.nardukShell.sections` (a copy — mutating the state
never edits the config), and after that it is the app's: pushing, removing or
editing a section re-renders the rail.

```ts
// app/plugins/admin-rail.ts
export default defineNuxtPlugin(() => {
  const { isAdmin } = useSession()
  if (isAdmin.value) {
    useNardukShellSections().value.push({
      id: 'admin',
      label: 'Admin',
      items: [{ label: 'Users', to: '/admin/users' }],
    })
  }
})
```

A `sections` prop overrides the shared state for that one shell instance.

#### Types

Exported from the package root:

```ts
import type {
  NeAppShellAppConfig, // app.config.nardukShell: { accent?, structure?, sections? }
  NeAppShellItem, // { label: string; to: string; icon?: string; badge?: string | number }
  NeAppShellProps,
  NeAppShellSection, // { id: string; label: string; items: NeAppShellItem[] }
  NeAppShellVariant, // 'rail'
} from '@narduk-enterprises/narduk-shell'
```

#### Supersedes

narduk-core's `LayerAppShell`, `LayerChromelessShell` and `LayerDashboardShell`
are deprecated in favour of `NeAppShell` and are removed in the next narduk-core
major. Their behaviour is unchanged until then.

### NeSkipLink

"Skip to content" that moves keyboard focus, not only the scroll position
([narduk-libs#977](https://github.com/narduk-enterprises/narduk-libs/issues/977)).
The link apps hand-rolled — Nuxt UI's link component with `to="#main-content"` —
renders a RouterLink, whose click handler calls `preventDefault` and
`router.push`: the page scrolled, focus stayed on the link, and the next Tab
went straight back into the navigation it was meant to skip.

`NeSkipLink` is a plain `<a href="#main-content">`, never a RouterLink. It keeps
the browser's own fragment navigation (the hash, the scroll, back/forward) and
adds one step in its click handler, which Enter on a focused link also fires: it
finds the target by id, gives it `tabindex="-1"` if it has no tabindex of its
own (a `<main>` is not focusable otherwise), and calls `focus()`. A tabindex the
target already has is kept. The click is never prevented, and a modified click
(a new tab or window) is left to the browser. In development, a missing target
logs a `[narduk-shell]` warning and focus stays on the link.

It is visually hidden (clipped, still in the Tab order) until it has focus, then
drawn over the top-left corner of its nearest positioned container, in
`--ne-surface` with `--ne-ink` text and an `--ne-accent` outline. Put it first
in the layout, so it is the first Tab stop.

`NeAppShell` renders one aimed at its own `<main>`; a layout without the shell
writes its own.

#### Example

```vue
<!-- app/layouts/default.vue — NE_MAIN_ID is auto-imported by the module -->
<template>
  <NeSkipLink />
  <AppHeader />
  <main :id="NE_MAIN_ID">
    <slot />
  </main>
</template>
```

```vue
<!-- A second target, with its own text -->
<NeSkipLink target="results" label="Skip to results" />
```

#### Props

| Prop     | Type     | Default             | What it does                                                                                                         |
| -------- | -------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `target` | `string` | `NE_MAIN_ID`        | The id (no `#`) of the element to focus. `NE_MAIN_ID` is `'main-content'`. The element needs no tabindex of its own. |
| `label`  | `string` | `'Skip to content'` | The link's text.                                                                                                     |

#### Slots

None. The text is `label`.

#### Events

None. A native `click` listener on the component still reaches the anchor.

#### `NE_MAIN_ID`

`'main-content'`: the id of the page's main content and the link's default
target, so the layout's `<main>` and the link are one constant rather than two
hand-typed strings. The module **auto-imports** it (alongside
`defineStatusMap`), so a layout writes `:id="NE_MAIN_ID"` with no import. App
code cannot value-import it from `@narduk-enterprises/narduk-shell`: Nuxt's
import protection refuses a bare import of any installed module's entry path
("Importing directly from module entry-points is not allowed"). The root barrel
still exports it, for code outside a Nuxt app build such as a unit test.

#### Types

```ts
import type { NeSkipLinkProps } from '@narduk-enterprises/narduk-shell'
```

### NeHero

The top of a landing page: a headline, the page's one `<h1>`, a description,
call-to-action buttons and an optional media slot. Backlog item 21
([narduk-libs#268](https://github.com/narduk-enterprises/narduk-libs/issues/268)),
the first of the four marketing sections (`NeHero`, `NeFeatureGrid`, `NeCta`,
`NeMarketingFooter`).

All four are **thin themed wrappers**. Each takes its Nuxt UI primitive's own
props and slots under the same names and defaults — read against `@nuxt/ui`
4.11.1 — and adds nothing but the suite's token classes, through the primitive's
own `ui` prop. The `theme.css` bridge already carries surfaces, ink and borders
(`text-highlighted` is `--ne-ink`, `bg-default` is `--ne-surface`), so the
wrappers only theme what the bridge cannot reach: places where Nuxt UI reaches
for its `primary` alias or its own radius step. A `ui` you pass merges **after**
the suite's classes, slot by slot, so your class wins a conflict and the rest of
the suite's look stays; a replacer function (`defaults => '…'`) replaces the
suite's class along with Nuxt UI's. A `class` attribute falls through to the
root.

`NeHero` wraps `UPageHero`. The headline reads `--ne-accent` instead of
`text-primary` (an eyebrow is brand chrome, which is what the accent hook is
for) and the title's tracking reads `--ne-tracking-tight`. `UPageHero` always
renders the title as an `<h1>`, so use one `NeHero` per page.

The estate's prior art is circuit-breaker-online's `EquipmentPage.vue` /
`IndustryPage.vue` (the "MarketingPageTemplate" of the components evidence
survey, 12 landing pages): a breadcrumb headline, a title with one highlighted
phrase, a description and two buttons. That is this component's `headline`,
`#title` slot and `links`.

#### Example

```vue
<NeHero
  headline="Equipment"
  description="Load-tested breakers from every major manufacturer, on the truck by 3pm."
  :links="[
    { label: 'Browse the catalog', to: '/products' },
    {
      label: 'Request a quote',
      to: '/contact',
      color: 'neutral',
      variant: 'outline',
    },
  ]"
>
  <template #title>
    Circuit breakers <span class="text-[var(--ne-accent)]">that ship today</span>
  </template>
</NeHero>
```

#### Props

| Prop          | Type                         | Default      | Notes                                                                                   |
| ------------- | ---------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| `headline`    | `string`                     | —            | Small label above the title, in `--ne-accent`.                                          |
| `title`       | `string`                     | —            | The page's `<h1>`. The `#title` slot overrides the text, still inside the `<h1>`.       |
| `description` | `string`                     | —            | Supporting copy under the title.                                                        |
| `links`       | `NeMarketingLink[]`          | —            | `UButton` props (`label`, `to`, `color`, `variant`, `icon` …), rendered at `size="xl"`. |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | `vertical` centres the text; `horizontal` puts the default slot beside it.              |
| `reverse`     | `boolean`                    | `false`      | Default slot before the text.                                                           |
| `as`          | `string`                     | `'div'`      | Root element.                                                                           |
| `ui`          | `Partial<Record<slot, …>>`   | —            | `UPageHero`'s slots: `root`, `container`, `wrapper`, `header`, `headline`, `title` …    |

#### Slots

`top`, `header`, `headline`, `title`, `description`, `body`, `footer`, `links`,
`default` (media beside or below the text) and `bottom` — `UPageHero`'s own. A
slot is forwarded only when you fill it, so Nuxt UI's own "is this block
present" checks behave exactly as they do on `UPageHero`.

#### Events

None. Buttons are `UButton`s: pass `to` or `onClick` in a `links` entry.

#### Types

```ts
import type {
  NeHeroProps,
  NeMarketingLink,
  NeMarketingOrientation,
} from '@narduk-enterprises/narduk-shell'
```

### NeFeatureGrid

A responsive grid of feature tiles — icon, title, description, optionally a
whole-tile link — over `UPageGrid` (the one-, two-, three-column grid) and
`UPageFeature` (one tile). Backlog item 21
([narduk-libs#268](https://github.com/narduk-enterprises/narduk-libs/issues/268)).

`features` joins the two exactly the way Nuxt UI's own `UPageSection` renders
its `features` prop: a `<ul>` of `UPageFeature`s rendered `as="li"`, each bound
to one entry unchanged. An empty list renders nothing rather than an empty
`<ul>`. The default slot replaces the tiles for a grid of anything else, and the
grid then renders as a `<div>`. Each tile's leading icon reads `--ne-accent`
instead of `text-primary`.

The grid has no heading of its own; put an `NeSectionHeader` above it.

#### Example

```vue
<NeSectionHeader title="Why buy from us" as="h2" />
<NeFeatureGrid
  :features="[
    {
      title: 'Tested',
      description: 'Every breaker is load-tested.',
      icon: 'i-lucide-zap',
    },
    {
      title: 'Same day',
      description: 'Orders before 3pm ship today.',
      icon: 'i-lucide-truck',
    },
    {
      title: 'Support',
      description: 'Engineers answer the phone.',
      to: '/contact',
    },
  ]"
/>
```

#### Props

| Prop       | Type                   | Default          | Notes                                                                                                                        |
| ---------- | ---------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `features` | `NeFeature[]`          | `[]`             | `UPageFeature` props per tile: `title`, `description`, `icon`, `orientation` (`'horizontal'` default), `to`, `target`, `ui`. |
| `as`       | `string`               | `'ul'` / `'div'` | `'ul'` when `features` renders the tiles, `'div'` when the default slot does.                                                |
| `ui`       | `{ base?: SlotClass }` | —                | `UPageGrid`'s one slot. A tile's own classes go in its entry's `ui`.                                                         |

#### Slots

| Slot      | When it renders                                    |
| --------- | -------------------------------------------------- |
| `default` | Replaces the tiles; the grid renders as a `<div>`. |

#### Events

None. A tile with `to` is a whole-tile link named by its title (Nuxt UI's
`ULink`); a tile's `onClick` is `UPageFeature`'s own.

#### Types

```ts
import type {
  NeFeature,
  NeFeatureGridProps,
} from '@narduk-enterprises/narduk-shell'
```

### NeCta

A call-to-action panel — an `<h2>` title, a description, buttons, and an
optional slot beside or below the text — over `UPageCTA`. Backlog item 21
([narduk-libs#268](https://github.com/narduk-enterprises/narduk-libs/issues/268)).

The panel is rounded to `--ne-radius-panel`, the suite's one panel radius,
instead of Nuxt UI's larger `rounded-xl`, so a CTA and an `NeCard` round alike.
Every `variant` is `UPageCTA`'s and themes through the bridge: `outline` (the
default) is `--ne-surface` with a `--ne-hairline` ring, `solid` is
`--ne-surface-inverted`, `soft` and `subtle` are `--ne-surface-elevated`.

#### Example

```vue
<NeCta
  title="Need a quote?"
  description="Tell us what you need and we will find it fast."
  :links="[{ label: 'Get a quote', to: '/contact' }]"
/>
```

#### Props

| Prop          | Type                                                    | Default      | Notes                                                       |
| ------------- | ------------------------------------------------------- | ------------ | ----------------------------------------------------------- |
| `title`       | `string`                                                | —            | Rendered as an `<h2>`.                                      |
| `description` | `string`                                                | —            |                                                             |
| `links`       | `NeMarketingLink[]`                                     | —            | `UButton` props, rendered at `size="lg"`.                   |
| `variant`     | `'outline' \| 'solid' \| 'soft' \| 'subtle' \| 'naked'` | `'outline'`  |                                                             |
| `orientation` | `'vertical' \| 'horizontal'`                            | `'vertical'` | `horizontal` puts the default slot beside the text.         |
| `reverse`     | `boolean`                                               | `false`      | Default slot before the text.                               |
| `as`          | `string`                                                | `'div'`      | Root element.                                               |
| `ui`          | `Partial<Record<slot, …>>`                              | —            | `UPageCTA`'s slots: `root`, `container`, `title`, `links` … |

#### Slots

`top`, `header`, `title`, `description`, `body`, `footer`, `links`, `default`
and `bottom` — `UPageCTA`'s own, forwarded only when filled.

#### Events

None. Buttons are `UButton`s: pass `to` or `onClick` in a `links` entry.

#### Types

```ts
import type { NeCtaProps, NeCtaVariant } from '@narduk-enterprises/narduk-shell'
```

### NeMarketingFooter

The footer of a public site, over `UFooter`: an optional full-width `#top` row
(link columns), then a left / centre / right row, then an optional `#bottom`
row. Backlog item 21
([narduk-libs#268](https://github.com/narduk-enterprises/narduk-libs/issues/268)).
It renders a `<footer>` — the page's `contentinfo` landmark — by default, under
a `--ne-hairline` rule.

Link columns are Nuxt UI's own `UFooterColumns` placed in `#top`; the wrapper
does not grow a `columns` prop of its own.

#### Example

```vue
<NeMarketingFooter>
  <template #top>
    <UFooterColumns
      :columns="[
        { label: 'Catalog', children: [{ label: 'Breakers', to: '/products' }] },
        { label: 'Company', children: [{ label: 'Contact', to: '/contact' }] },
      ]"
    />
  </template>
  <template #left>
    <p class="text-sm text-muted">© 2026 Example Co.</p>
  </template>
  <template #right>
    <UButton to="/contact" label="Contact" color="neutral" variant="ghost" />
  </template>
</NeMarketingFooter>
```

#### Props

| Prop | Type                       | Default    | Notes                                                                               |
| ---- | -------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `as` | `string`                   | `'footer'` | Root element. Keep `footer` unless the page already has a `contentinfo`.            |
| `ui` | `Partial<Record<slot, …>>` | —          | `UFooter`'s slots: `root`, `top`, `bottom`, `container`, `left`, `center`, `right`. |

#### Slots

| Slot      | When it renders                                                  |
| --------- | ---------------------------------------------------------------- |
| `top`     | Full-width row above the main row — typically `UFooterColumns`.  |
| `left`    | Start of the main row on wide screens; last when the row stacks. |
| `default` | Middle of the main row.                                          |
| `right`   | End of the main row on wide screens; first when the row stacks.  |
| `bottom`  | Full-width row below the main row.                               |

#### Events

None.

#### Types

```ts
import type { NeMarketingFooterProps } from '@narduk-enterprises/narduk-shell'
```

## Formatters (`./format`)

```ts
import { createFormatters } from '@narduk-enterprises/narduk-shell/format'
```

Backlog item 5
([narduk-libs#252](https://github.com/narduk-enterprises/narduk-libs/issues/252)).
Ten functions for dates, numbers, money, percentages, quantities and spans,
built on `Intl` and on nothing else. No Vue, no Nuxt, no dependency: the same
function is callable from a component, from a Nitro route, from a plain Node
script and from `nuxt.config.ts`.

### The rule the whole module is built around

**Nothing here reads the ambient clock or the host time zone.** `timeZone` is
required by the _types_ on every date formatter, and `formatRelative` requires
`now` the same way. Neither is defaulted, because the default is exactly the
bug: a Nuxt page renders once on a server (UTC, in a Cloudflare Worker) and
again in the reader's browser (their zone, their locale), so a formatter that
consults either one produces two different strings for one value and Vue's
hydration check turns that into a flicker or a dropped server render. That is
operator-portal#262 and #268, stonx#674 and #675, and riverstatus's hand-rolled
DST table, four times over.

The zone an app passes should be a **decision** — the market's zone, the gauge's
zone, `'UTC'` — and never `Intl.DateTimeFormat().resolvedOptions().timeZone`.
`createFormatters()` is where an app makes that decision once.

`test/format.ssr.test.ts` is what makes this a rule rather than a convention. It
runs the whole surface in a **child process** under `TZ` of `UTC`,
`America/Chicago`, `Asia/Tokyo` and `Australia/Eucla` and `LC_ALL` of `en-US`,
`de-DE` and `ja-JP`, and requires byte-identical stdout; Node reads both
variables at process start, so a child process is the only honest way to test
it. The same file greps the source for `Date.now`, `new Date()`,
`resolvedOptions()`, `navigator.language` and an `Intl` constructor called
without an explicit locale, and carries a canary proving the host environment
_does_ move an unpinned `Intl` formatter — so the comparison is a gate that can
fail.

### `src/format.ts` is deliberately one file

The module is a single file with **no relative imports at all**. The obvious
shape — a `src/runtime/format/` directory of small modules — is not one this
package can have, for three reasons:

- `scripts/check-component-surface.mjs` `import()`s `src/format.ts` in plain
  Node. Node's ESM resolver does no extension guessing, so a relative `./x`
  specifier fails with `ERR_MODULE_NOT_FOUND` and the check — which fails closed
  — fails.
- Node's native type stripping does not remap a `./x.js` specifier onto `x.ts`,
  so the usual TypeScript workaround does not apply either.
- Writing `./x.ts` fixes Node and breaks every consuming app:
  `exports["./format"].types` points at this same file, and an app's own `tsc`
  rejects an explicit `.ts` extension with **TS5097** unless it enables
  `allowImportingTsExtensions`, which this package may not require of its
  consumers.

The third one is asserted by `test/format.ssr.test.ts`, so the trap cannot be
walked back into. A reviewer who wants the directory shape must first give the
surface check a bundler.

### Defaults, in one place

| Behaviour        | Default                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `locale`         | `'en-US'` — a fixed value, never the host's                            |
| `empty`          | `'—'`, rendered for `null`, `undefined`, `NaN` and unparseable input   |
| Date style       | `'medium'` (`Mar 8, 2026`); time style `'short'` (`3:30 AM`)           |
| Unit display     | `'narrow'` for durations (`1h 30m`), `'short'` for quantities (`5 ft`) |
| `Intl` instances | memoised per kind, keyed by locale plus the full sorted option set     |
| Unit support     | feature-tested once per distinct `unit` string, then memoised          |

The memo cache is capped at 256 entries per kind and clears wholesale on
overflow. The cap is there because an option set can be derived from data
(`digits` off a column definition, `currency` off a row), which is the one way
the cache could grow with the working set rather than with the code; real call
sites re-populate a handful of entries immediately, and an adversarial one pays
a rebuild instead of growing without bound.

The unit-support cache carries the same cap and clear-on-overflow behaviour, for
the same reason: `formatQuantity`'s `unit` values come off live feeds such as
USGS (`cfs`, `ft3/s`), not a fixed code-defined set (narduk-libs#287).

### `formatDate`

```ts
formatDate('2026-03-08T08:30:00Z', { timeZone: 'America/Chicago' }) // 'Mar 8, 2026'
formatDate(row.startsOn, { timeZone: 'UTC', style: 'full' })
```

`timeZone` is required. A bare `YYYY-MM-DD` is treated as a **floating calendar
date** with no instant, because that is what it is: `new Date('2026-03-08')` is
midnight UTC, and rendering that in `America/Chicago` shows the 7th — the most
common way a date lands on screen one day early. `formatDateTime` deliberately
does not do this; a value with a time in it is an instant.

### `formatDateTime`

```ts
formatDateTime(at, { timeZone: 'America/Chicago' }) // 'Mar 8, 2026, 3:30 AM'
formatDateTime(at, { timeZone: 'America/Chicago', timeZoneName: 'short' }) // '… 3:30 AM CDT'
```

`timeZoneName` is what riverstatus's hand-rolled DST table was for: `Intl` knows
the real transition dates for every zone, including the ones that are not the
United States'. It is appended from a second formatter because
`Intl.DateTimeFormat` throws a `TypeError` when `timeZoneName` is combined with
`dateStyle`/`timeStyle`.

### `formatRelative`

```ts
formatRelative(at, { now, timeZone: 'America/Chicago' }) // '3 hours ago'
formatRelative(at, { now, timeZone: 'America/Chicago', numeric: 'always' }) // '3 hours ago' / '1 day ago'
```

`now` is required — it is the injected clock. Below 45 seconds the answer is in
seconds, below 45 minutes in minutes, and below 22 hours in **hours** even when
the two instants fall on different local days: something posted at 23:30 last
night reads `2 hours ago`, not `yesterday`. Above that the ladder switches to
the calendar, and days are counted in the caller's zone, so one 30-hour span
reads `2 days ago` in Chicago and `yesterday` in Tokyo. The 23-hour day a
spring-forward produces still reads `yesterday`.

### `calendarDateIn`

```ts
calendarDateIn('2026-03-08T04:30:00Z', { timeZone: 'America/Chicago' }) // '2026-03-07'
calendarDateIn('2026-03-08', { timeZone: 'Asia/Tokyo' }) // '2026-03-08'
```

The calendar date of an instant in a named zone, as a sortable `YYYY-MM-DD` key:
grouping readings by the station's day, or asking "is this today on the farm's
clock?". It replaces the `new Intl.DateTimeFormat('en-CA', …).format()` trick
five apps hand-rolled (narduk-libs#992): that relies on `en-CA`'s formatted
pattern, which is CLDR locale data rather than a format contract. This reads
`Intl`'s parts instead, and its output is byte-identical to the `en-CA` form
wherever that form is correct. `timeZone` is required, a bare `YYYY-MM-DD`
passes through unchanged (a floating calendar date, as in `formatDate`), and an
unknown zone throws `RangeError` rather than falling back to the host zone.

### `isSameCalendarDay`

```ts
isSameCalendarDay(reading.at, now, { timeZone: farm.timeZone }) // "is this today?"
```

Whether two values fall on the same calendar day in `timeZone`, built on
`calendarDateIn`. Absent or unparseable input on either side is never the same
day. Choosing the zone stays with the app: the farm's recorded zone, Chicago for
the portal. Pass `now` in explicitly, as everywhere in this module.

### `formatDuration`

```ts
formatDuration(5_400_000) // '1h 30m'
formatDuration(5_400_000, { unitDisplay: 'long' }) // '1 hour 30 minutes'
formatDuration(-90_000) // '-1m 30s'
```

Two components by default, from the largest non-zero unit down, trailing zero
components trimmed. It never climbs above a day: a month is not a fixed span,
and a duration that silently means "about a month" is worse than `45d`. A
negative span keeps its sign rather than becoming `'unknown'` the way
operator-portal's `formatAge` does — a clock skew should be visible, not
laundered.

### `formatNumber`

```ts
formatNumber(1234.5678, { digits: 2 }) // '1,234.57'
```

`digits` sets minimum and maximum fraction digits together; the two `Intl`
options are still available separately for the cases that need them.

### `formatCompact`

```ts
formatCompact(1234) // '1.2K'
formatCompact(1_234_567) // '1.2M'
```

`Intl`'s own compact notation, not stonx's hand-rolled `K`/`M`/`B`/`T` ladder —
the ladder is English-only. One visible consequence of the plan's signature
winning: the default is one fraction digit where stonx's was two, so a call site
that needs the old shape passes `{ digits: 2 }`. A `minimumFractionDigits` above
one raises that default ceiling to match (`{ minimumFractionDigits: 2 }` gives
`1.23K`) rather than throwing.

### `formatPercent`

```ts
formatPercent(0.055) // '5.5%'
formatPercent(5.5, { input: 'percent' }) // '5.5%'
```

The default reading is `Intl`'s: the argument is a **fraction**. stonx's
formatter defaults the other way, behind a `fromDecimal` flag, so an adoption
that silently inherited a default would be wrong by a factor of 100 in a
direction nothing catches. `input` is therefore spelled out at the call site
rather than inferred.

One fraction digit by default. `digits`, or `minimumFractionDigits` /
`maximumFractionDigits`, replaces that default, as in the other number
formatters: `formatPercent(0.5, { maximumFractionDigits: 0 })` is `'50%'`.

### `formatMoney`

```ts
formatMoney(1234.5, { currency: 'USD' }) // '$1,234.50'
formatMoney(1234.5, { currency: 'EUR', locale: 'de-DE' }) // '1.234,50 €'
```

`currency` is required because there is no house currency, and fraction digits
are the currency's own — `JPY` has none, `USD` has two. `timeZone` is accepted
and ignored so that one bound option bag fits every formatter in the suite.

### `formatQuantity`

```ts
formatQuantity(5, { unit: 'foot' }) // '5 ft'
formatQuantity(1234, { unit: 'cfs' }) // '1,234 cfs'
```

`Intl` throws a `RangeError` for any unit outside its sanctioned list, and half
the estate's units are outside it — riverstatus alone reads `cfs` and `ft3/s`
off the USGS feed. An unsanctioned unit is appended after a space instead.

### `createFormatters`

```ts
// app/utils/formatters.ts
export const fmt = createFormatters({ timeZone: 'America/Chicago' })

fmt.formatDateTime(row.observedAt) // 'Mar 8, 2026, 3:30 AM'
fmt.formatRelative(row.observedAt, { now }) // '3 hours ago'
fmt.formatMoney(row.total, { currency: 'USD' })
fmt.formatDate(row.observedAt, { timeZone: 'UTC' }) // per-call options win
```

The intended entry point, and the reason `timeZone` being required is a one-line
cost rather than a 228-call-site one. The returned object is frozen.

These formatters are **not** auto-imported by the Nuxt module, deliberately:
every pilot app already has its own `formatDate` in `app/utils/`, and a global
auto-import of a different `formatDate` with a different required signature
would shadow it at the worst possible moment. Import the subpath, or bind a set
in `app/utils/` and import that.

## Component surface check

`node scripts/check-component-surface.mjs`, from the repository root, reads the
surface this package actually exports — every entry in `src/registry.ts` and
every named export of `./format` — and requires the evidence for each name to
exist. It runs in `pnpm run quality` (inside `quality:artifacts`, straight after
`format:check`) and can be run on its own:

```bash
pnpm run surface:check            # this package
node scripts/check-component-surface.mjs --json   # machine-readable, for CI
```

A **registered component** must satisfy four rules. A miss prints one line per
rule with the exact fix, and the command exits 1.

| Rule     | Satisfied by                                                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readme` | a Markdown heading in this file naming the component (`### NeStatePanel`). A mention in a paragraph or a table row does not count — the point is a section with props, slots, events and an example. |
| `mount`  | a `*.test.ts` anywhere in this package containing `mount(<Name>` — by convention `src/runtime/components/<Name>.test.ts`, using `@vue/test-utils`.                                                   |
| `ssr`    | a test file named `<Name>.ssr.test.ts` (or the shared `ssr.test.ts`) that names the component and calls `renderToString`, in vitest's `node` environment.                                            |
| `card`   | `src/design-cards/<Name>.card.vue` containing `data-design-card="<kebab-name>"` — see **Shipping a design card** below.                                                                              |

A **`./format` export** must satisfy two: `readme`, and `unit` — a `*.test.ts`
in this package that imports it from the `format` module and asserts its output.
The plan's sentence applies all four rules to format exports too; three of them
cannot exist for a pure function (`mount()` takes a component, an SSR render
needs something to render, a card is a rendered preview), so requiring them
would only produce fictions. That deviation is deliberate and recorded here and
in
[narduk-libs#250](https://github.com/narduk-enterprises/narduk-libs/issues/250).

`./format` ships a card anyway — `src/design-cards/Formatters.card.vue` — but as
a choice rather than a rule. A card is where a designer sees what the house date
and money formats actually look like, which is worth having; requiring one of
every future exported function is not. See **Shipping a design card** for the
list that authorises it.

The check reads the registry and `format` by **importing the TypeScript
directly** — Node strips types natively and these modules are plain erasable
TypeScript — so it sees the real export list rather than whatever a regex
matches. If a module cannot be loaded it fails closed with the loader error
instead of reporting an empty, trivially passing surface.

Scope today is this package. The owned directories live in
`CHECKED_PACKAGE_DIRS` in `scripts/check-component-surface.mjs` — item 22
appends `packages/design/narduk-ui` and `packages/design/narduk-charts` there,
one line each. Naming one of them now is an error rather than a silent pass.
What a later lane must add is listed under **Adding a component**.

## Shipping a design card

An NE Base card ships **with its component**, in this package, not as a
hand-written section in another one. Copy the template and edit it:

```bash
cp packages/design/narduk-shell/src/design-cards/template/NeExample.card.vue \
   packages/design/narduk-shell/src/design-cards/NeStatePanel.card.vue
```

The card is an ordinary single-file component whose root element is a
`<section>` carrying three attributes:

```vue
<script setup lang="ts">
// Import the component explicitly: the renderer mounts this file outside the
// Nuxt module, so `addComponent` registration does not apply there (and an
// unimported component is a `vue/no-undef-components` lint failure).
import NeStatePanel from '../runtime/components/NeStatePanel.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-state-panel"
    data-name="State panel"
    data-group="Shell"
  >
    <h2>State panel</h2>
    <div class="preview-row"><NeStatePanel title="Ordinary" /></div>
    <div class="preview-row"><NeStatePanel title="Busy" loading /></div>
    <div class="preview-row">
      <NeStatePanel title="Nothing to show" empty />
    </div>
  </section>
</template>
```

- `data-design-card` is the **kebab-case of the registered name**
  (`NeStatePanel` → `ne-state-panel`). The surface check asserts exactly this.
- `data-name` and `data-group` are the card's title and section in NE Base.
  `design-system-build` refuses a card section missing either.
- Show the states a reviewer has to see, with fixed demonstration values. Cards
  are prerendered statically: no scripts, no network, no external assets.
- `src/design-cards/template/` is deliberately **not** discovered. Only
  `src/design-cards/*.card.vue` at the top level becomes a card.

Nothing else registers the card. `packages/design/design-system-build` globs
`src/design-cards/*.card.vue`, renders each one into the NE Base gallery, and
fails its build when a registered component has no card (unless the name is on
`PENDING_CARDS`), when a card is authorised by neither `src/registry.ts` nor
`src/surface-cards.ts`, when two cards claim the same id, or when an authored
card does not reach the prerendered output. `test/design-cards.test.ts` in this
package server-renders every card — including the template — and asserts the
same pairing, so a card that only works after hydration fails here rather than
showing up blank in NE Base.

### A card for something that is not a component

`src/surface-cards.ts` is the second — and much smaller — list that may
authorise a card. It exists for `Formatters.card.vue`, which previews the
`./format` subpath and has no component to be named after. Without it the
pairing rule above rejects the card outright, which is the rule working as
intended: NE Base showing a card for something no app can import is the failure
it prevents.

So the hole is narrow and fails closed in both directions. A name on that list
**must** have a card file — there is no `PENDING_CARDS` equivalent, because that
waiver was for a component landing ahead of its card and it is spent. A card
named by neither list is still an error, and a name on both lists is an error
too, since one card id cannot be rendered twice. `test/design-cards.test.ts`
asserts all of that from this side, `shellCardPlan` in
`design-system-build/scripts/build.mts` from the other, and the list is capped
at three entries by a test: past a handful, the shape is wrong and the card
belongs to something the registry knows about.

The hand-authored cards for `narduk-ui` and the Nuxt UI baseline stay in
`design-system-build/app/app.vue` and keep working unchanged; backlog item 22
migrates them to this mechanism. `/design-sync` is unaffected: the renderer's
output shape (`@dsCard` previews, `tokens.css`, `styles.css`,
`_ds_manifest.json`, `build-manifest.json`) is exactly what it was.

## Publication

Source is TypeScript, Vue and CSS with no build step — the same shape
`narduk-core`, `narduk-analytics` and `narduk-ui` publish. The module adds
`@narduk-enterprises/narduk-shell` to the consuming app's `build.transpile`, so
the app's own Vite build compiles what it imports.
