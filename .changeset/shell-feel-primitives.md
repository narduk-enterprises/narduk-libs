---
'@narduk-enterprises/narduk-shell': minor
---

Add the "feel" primitives: the interaction rules behind a Notion-like "works
like butter" app, as tokens, utility classes and composables.

- `theme.css`: `--ne-feel-fast` (120ms), `--ne-feel-base` (150ms) and
  `--ne-ease-out`; the `.ne-press`, `.ne-hover-reveal` + `.ne-reveal`,
  `.ne-fade-in`, `.ne-fade-*` (`<Transition name="ne-fade">`) and `.ne-skeleton`
  utilities. They animate opacity and transform only, keep hover-revealed
  controls visible on touch and under focus, and collapse under
  `prefers-reduced-motion`.
- Auto-imported composables: `useOptimistic` (apply now, roll back and toast on
  failure), `useInlineEdit` (headless click-to-edit built on it),
  `useSlashFocus` ("/" focuses a search field, on Nuxt UI's `defineShortcuts`)
  and `useReducedMotion` (SSR-safe `Ref<boolean>`). Their types are exported
  from the package root.

Refs narduk-enterprises/agent-infrastructure#3162.
