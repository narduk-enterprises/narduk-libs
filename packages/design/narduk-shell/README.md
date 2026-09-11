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

**Filling up, one backlog item at a time.** Item 1
([narduk-libs#248](https://github.com/narduk-enterprises/narduk-libs/issues/248))
laid down the package, the module, the registration model and the reserved
subpaths. Each later item adds its own component, README section, tests and NE
Base card; what has landed is listed under [Components](#components) below. The
tokens (item 2) have not landed yet.

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
    // Register the suite globally. Default: true.
    // `false` keeps the package installed and the ./format and ./theme.css
    // subpaths importable, but registers no global component names and no
    // composable auto-imports.
    components: true,
  },
})
```

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

Exactly three subpaths are exported. Two of them are reserved placeholders in
this release: they resolve from an external install today (the release
pipeline's consumer fixture proves it) and are filled by the backlog items
below, so that no app has to change an import specifier when the content
arrives.

| Subpath                                      | Today                      | Filled by                                                                                                               |
| -------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@narduk-enterprises/narduk-shell`           | The Nuxt module            | Every component item adds a registry entry                                                                              |
| `@narduk-enterprises/narduk-shell/format`    | Empty module (`export {}`) | Item 5, shared `Intl`-based formatters ([#252](https://github.com/narduk-enterprises/narduk-libs/issues/252))           |
| `@narduk-enterprises/narduk-shell/theme.css` | Empty stylesheet           | Item 2, NE tokens mapped onto Nuxt UI's `--ui-*` ([#249](https://github.com/narduk-enterprises/narduk-libs/issues/249)) |

## Components

Each component arrives with its own backlog item, and each adds its section here
— props, slots, events and one example — alongside a mount test, an SSR test and
an NE Base card. The ordered backlog is
[narduk-libs#247](https://github.com/narduk-enterprises/narduk-libs/issues/247)
and the plan it tracks is
[`docs/plans/components-library-plan.md`](../../../docs/plans/components-library-plan.md).

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

`useConfirm()` is auto-imported by the module and built on Nuxt UI's
`useOverlay`, so the app needs a `UApp` (or a bare `UOverlayProvider`) above it
— which every Narduk app already has. One handle drives one dialog at a time:
call `useConfirm()` once per `setup` and await each `confirm()` before starting
the next.

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

## Publication

Source is TypeScript, Vue and CSS with no build step — the same shape
`narduk-core`, `narduk-analytics` and `narduk-ui` publish. The module adds
`@narduk-enterprises/narduk-shell` to the consuming app's `build.transpile`, so
the app's own Vite build compiles what it imports.
