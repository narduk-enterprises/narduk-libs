---
'@narduk-enterprises/create-narduk-app': patch
---

New apps get a strict `apps/web/lint-budget.json`,
`{ "strict": true, "rules": {} }` (#713). A warning in a rule with no budget
entry now fails `pnpm lint` in a fresh app, instead of being recorded as that
rule's budget and passing. Adopt one on purpose with
`narduk-lint --accept-new-rules`. Needs `@narduk-enterprises/eslint-config`
2.2.0 or later, which the generator already pins (2.2.1). Existing apps are
unchanged until they add the key.
