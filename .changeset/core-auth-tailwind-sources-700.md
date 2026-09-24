---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core and narduk-auth register the files they render with Tailwind and
with Nuxt UI's component detection (narduk-libs#700). Nuxt UI adds an `@source`
and scans for `U*` components only in Nuxt layers, and both packages are
modules, so their utilities existed only when a Nuxt UI theme happened to name
the same class, and `ui.experimental.componentDetection` dropped the themes of
components only they render.

- narduk-auth adds its `app/` directory to the `@source` lines in Nuxt UI's
  `ui.css`: `/auth/callback`, `/auth/confirm` and the sign-in pages keep
  `px-4`, `font-bold`, `min-h-[calc(100vh-8rem)]` and their card widths.
- With `componentDetection` on, both modules add the Nuxt UI components their
  own files render (core's `UButton` on the error page and the `UDashboard*`
  shell; auth's `UAlert` and `UCard`, among others) to the detection list. An
  app no longer lists module files or components to turn detection on.
- narduk-core exports the helper as
  `@narduk-enterprises/narduk-core/nuxt-ui-sources` (`registerNuxtUiSources`)
  for other modules that ship app files.
