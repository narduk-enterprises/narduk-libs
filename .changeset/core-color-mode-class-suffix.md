---
'@narduk-enterprises/narduk-core': patch
---

Default `colorMode.classSuffix` to `''` so `@nuxtjs/color-mode` writes
`class="dark"` instead of `class="dark-mode"`. Tailwind v4 and Nuxt UI 4 key
dark styles on `.dark`, so the previous suffix left every dark token inert.

**Adoption.** Apps with no dark styling will start rendering Nuxt UI chrome dark
for dark-preference users. An app that wants light-only sets
`colorMode: { preference: 'light', fallback: 'light' }` (Buoys does). An app can
still override `classSuffix`.
