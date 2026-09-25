---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/create-narduk-app': patch
---

`no-locale-date-format-in-ssr-text` now matches `no-render-clock` on what counts as render code. It no longer reports locale date formatting inside a `v-on` / `@event` handler, which only runs after a user event. It now reports formatting inside a synchronous array callback (`items.map((i) => i.at.toLocaleDateString())`) or an IIFE at the top of `<script setup>` or inside `computed()`, which runs during server render.
