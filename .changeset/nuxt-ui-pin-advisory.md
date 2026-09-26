---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`foundation:check:shared-ui-pinned` warns when a UI app depends on `@nuxt/ui`
through a range (narduk-libs#1033). narduk-core, narduk-shell, narduk-auth,
narduk-seo, narduk-analytics and narduk-ai render Nuxt UI and pin it exactly.
The warning is a `[WARN]` summary line and an `advisories` entry in the JSON
artefact; it changes neither the result nor the exit code. Generated apps
already pin `@nuxt/ui` exactly, so they see no warning.
