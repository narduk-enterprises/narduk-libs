---
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/create-narduk-app': patch
---

The narduk-shell module now registers `src/runtime` with Tailwind through Nuxt
UI's `ui.css` `@source` lines. When an app turns
`ui.experimental.componentDetection` on, it also adds the `U*` components the
suite renders (narduk-libs#978). narduk-shell is a module, not a layer, so
before this a utility that only a `Ne*` component used was never generated in a
consuming app, and with detection on the suite's `U*` components lost their
themes. This is the same fix narduk-auth got in #700.
