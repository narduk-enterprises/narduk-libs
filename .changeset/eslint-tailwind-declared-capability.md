---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/create-narduk-app': patch
---

`createAppLintConfig` no longer enables the theme-resolving
`better-tailwindcss` rules just because `app/assets/css/main.css` exists or
`tailwindcss` happens to resolve (narduk-libs#665). Pass `tailwindEntryPoint`
to opt in. `create-narduk-app` is a companion patch so the generator pin moves
with eslint-config; no generator source change.
