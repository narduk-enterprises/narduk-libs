---
'@narduk-enterprises/narduk-shell': minor
---

Fix four defects found reviewing the suite's first components (narduk-libs#282).

- `useConfirm()` is re-entrant instead of silently broken. Nuxt UI's overlay
  keeps one resolver per overlay and `open()` overwrites it on every call, so a
  second `confirm()` started before the first settled orphaned the first
  resolver: that `await confirm(...)` never resolved, never rejected and never
  timed out — on a double-click of a row-level "Delete?", the case the
  composable exists for. A second call now supersedes the first, which resolves
  `false`, except when its `onConfirm` is still in flight: that promise is kept
  and settles with the real outcome, because the work cannot be unrun. A stale
  handler can no longer close or repaint the dialog a newer call owns.
- `NePageHeader` emits one breadcrumb landmark. `UBreadcrumb` is itself a `nav`
  and the `aria-label` passed to it lands on that same root, so the enclosing
  `<nav aria-label="Breadcrumb">` put two identically named navigation landmarks
  on every page using the shared header. The wrapper is gone and the accessible
  name is unchanged.
- The styling contract covers every registered component. Its source list is
  derived from `src/registry.ts` rather than written by hand, so registering a
  component covers it and none can be silently omitted; blocks are read with
  `vue/compiler-sfc` instead of a regex that stopped at the first nested
  `</template>`, and the script block is scanned too. Tailwind's type scale is
  recognised as a token read — `text-sm` compiles to `var(--text-sm)` — so the
  rule now forbids display type (`text-lg` and up, `font-semibold` and heavier)
  rather than the whole scale, and the two per-component copies of the same
  check are consolidated into it.
- `NeConfirmOptions` and `NeConfirmTone` are named exports of the package root
  (`.`), so a wrapper can state its signature outside Nuxt's auto-import
  transform. `useConfirm`'s own auto-import no longer sits behind the
  `components: false` early return: that option opts out of the suite's global
  component names, and the composable does not use them.

No API removals. The reserved export map stays `.`, `./format`, `./theme.css`.
