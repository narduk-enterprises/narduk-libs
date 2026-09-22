---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/eslint-config': patch
---

`better-tailwindcss/no-unknown-classes` no longer reports classes the app
defines itself (#55). `createAppLintConfig` collects class selectors from the
Tailwind entry stylesheet and the `.css` files it imports, including
`@narduk-enterprises/narduk-ui/tokens.css`, and from every Vue SFC `<style>`
block under `appRootDir`. It passes them to the rule as one exact-match
`ignore`. A typo, or a Tailwind variant on an app-defined class, is still
reported.
