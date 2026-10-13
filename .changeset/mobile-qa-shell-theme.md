---
'@narduk-enterprises/narduk-shell': minor
---

Nuxt UI theme and tokens for the mobile web QA rules. `app-config.ts` renders `input`, `inputMenu`, `inputNumber`, `inputTags`, `select`, `selectMenu` and `textarea` at 16px on a phone (`text-base sm:text-sm` for `xs`/`sm`), so iOS Safari stops zooming on focus, and gives `UButton` a `--ns-tap-min` (44px) minimum height and width on coarse pointers. `theme.css` adds `--ne-bottom-bar-h` (default `0px`) and `html { scroll-padding-bottom: var(--ne-bottom-bar-h) }`; see README § Bottom bar. The `[role=dialog]` overscroll rule moves out of the opt-in `bounce-guard.css` into narduk-core's base CSS. `NeCommandPalette`, `NeCommandPaletteTrigger` and `NeProse` hover styles are gated under `@media (hover: hover)`, and viewport-unit heights use `dvh`.
