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
ships `NeStatePanel`. Components read Nuxt UI semantic tokens and `UBadge`
colour/variant props, and do not hardcode a colour, radius, shadow or font. Each
later item adds its own component, README section, tests and NE Base card.

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

Exactly three subpaths are exported. One of them is still a reserved
placeholder: it resolves from an external install today (the release pipeline's
consumer fixture proves it) and is filled by the backlog item below, so that no
app has to change an import specifier when the content arrives.

| Subpath                                      | Today                                                                                  | Filled by                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@narduk-enterprises/narduk-shell`           | The Nuxt module                                                                        | Every component item adds a registry entry                                                                    |
| `@narduk-enterprises/narduk-shell/format`    | Empty module (`export {}`)                                                             | Item 5, shared `Intl`-based formatters ([#252](https://github.com/narduk-enterprises/narduk-libs/issues/252)) |
| `@narduk-enterprises/narduk-shell/theme.css` | The NE token layer and its `--ui-*` bridge (see [Styling contract](#styling-contract)) | Filled by item 2 ([#249](https://github.com/narduk-enterprises/narduk-libs/issues/249))                       |

`defineStatusMap` is a named export of the package root (`.`), not a fourth
subpath. Import it from `@narduk-enterprises/narduk-shell` the same way the
module itself is imported.

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

`test/styling-contract.test.ts` scans every component **the registry
registers** — the source list is derived from `src/registry.ts`, not written
out by hand, so a component is covered the moment it is registered and cannot
be silently left out. It reads the template, the script and any style block
(comments removed) and rejects a hex, `rgb()`/`hsl()`/`oklch()` literal, a raw
`font-family` / `box-shadow` / `border-radius` declaration, and Tailwind's
named radius and shadow steps.

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

#### `defineStatusMap`

Most consumers have their own status vocabulary — a flood stage, a device health
enum, a job state — that needs to become a `{ tone, label }` pair.
`defineStatusMap` builds that mapping once, typed so a missing union member is a
compile-time error and an unrecognised runtime value falls back to `neutral`
instead of throwing. It is a **named export of the package root**
(`@narduk-enterprises/narduk-shell`, `src/module.ts`) — not a fourth subpath;
the reserved map stays `.`, `./format`, `./theme.css`. Nuxt apps that register
the module also get it as an auto-import.

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
is hidden when `count` is `undefined`. Zero is a real, visible count. The
heading is an `h2` by default.

#### Props

| Prop          | Type                                           | Default | Description                                                        |
| ------------- | ---------------------------------------------- | ------- | ------------------------------------------------------------------ |
| `title`       | `string`                                       | —       | Section title. Required.                                           |
| `count`       | `number`                                       | —       | Item count shown as a token-themed badge. Hidden when `undefined`. |
| `description` | `string`                                       | —       | Supporting copy below the title.                                   |
| `as`          | `'h1' \| 'h2' \| 'h3' \| 'h4' \| 'h5' \| 'h6'` | `'h2'`  | Heading level for the title.                                       |

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
app does not mount a `<NeConfirmDialog>` host of its own.

#### Host mechanism

The composable is built on Nuxt UI's `useOverlay`. That is the host: `open()`
mounts `NeConfirmDialog` into the overlay stack and `close(boolean)` is what
`await confirm(...)` resolves with. The stack lives on `UApp` (or a bare
`UOverlayProvider`), which every Narduk app already has — narduk-core's
`LayerAppShell` wraps the tree in `UApp`. There is no module-registered host
component and no layout wiring.

One handle drives one dialog at a time: call `useConfirm()` once per `setup` and
await each `confirm()` before starting the next. Sequential calls resolve
independently; leftover `pending` / `error` from a rejected `onConfirm` is reset
on the next `open`.

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
`PENDING_CARDS`), when a card has no registered component, when two cards claim
the same id, or when an authored card does not reach the prerendered output.
`test/design-cards.test.ts` in this package server-renders every card —
including the template — and asserts the same pairing, so a card that only works
after hydration fails here rather than showing up blank in NE Base.

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
