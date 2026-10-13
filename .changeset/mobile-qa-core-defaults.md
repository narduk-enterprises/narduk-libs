---
'@narduk-enterprises/narduk-core': minor
---

Mobile web QA defaults every app inherits. `app.head` gains `viewport` with `viewport-fit=cover` (no zoom lock), `color-scheme`, light/dark `theme-color`, `format-detection` and `apple-mobile-web-app-*`; an app's own value wins, and `nardukCore: { head: false }` turns them off. `main.css` adds `touch-action: manipulation` and a transparent tap highlight on controls (visible `:focus-visible` kept), `overscroll-behavior: contain` on dialogs, and a `prefers-reduced-motion` block that neutralises transitions and animations including the page transitions. `.card-base:hover` is gated under `@media (hover: hover)`. The sticky `LayerAppHeader` pads `env(safe-area-inset-top)` and its logo and the dashboard account button are at least 44px. `min-h-screen` becomes `min-h-dvh` in `LayerAppShell`, `LayerDashboardShell`, `error.vue`, the landing layout, and `AppLightbox` uses `dvh`.
