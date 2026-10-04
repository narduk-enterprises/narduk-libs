---
'@narduk-enterprises/eslint-config': patch
---

Lint `.vue` files with the type-aware rules at `.ts` speed (narduk-libs#1393).
`.vue` files already joined the app's TypeScript program, but each one opened it
with its `<script>` text, which is not the text the program holds, so every file
replaced the program and built a new type checker, and the type-aware rules paid
their warm-up again for every file (about 4 s per `.vue` file that contains a
call). `createAppLintConfig` now ends with a `narduk/vue-program-warm` entry
that wraps `vue-eslint-parser`: once a run has parsed more than three distinct
`.vue` files it opens every other `.vue` file under the app root in the project
service, so the program stays put for the rest of the run and the warm-up is
paid once. No rule changes severity and no file is skipped. Set
`NARDUK_LINT_VUE_PROGRAM_WARM=0` to turn it off.
