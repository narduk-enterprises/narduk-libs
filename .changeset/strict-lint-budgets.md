---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/eslint-config': minor
'@narduk-enterprises/narduk-timeseries': patch
---

`narduk-lint` can now fail a warning in a rule that has no budget entry. A
`lint-budget.json` carrying `"strict": true` gates every rule: a new rule's
warnings exit non-zero, naming the rule and its locations, instead of being
recorded as the rule's budget and passing (#673). Adopt a new rule's current
count deliberately with `narduk-lint --accept-new-rules`, which refuses to run
in CI or with `--no-write`. A budget file without `strict` keeps the old
record-and-pass behaviour and now says so on every run. narduk-timeseries fixes
the one warning that behaviour had let through.
