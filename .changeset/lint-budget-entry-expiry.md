---
'@narduk-enterprises/eslint-config': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-lint` gives every budget entry that allows a warning a 7-day expiry.
Recording an entry (`--accept-new-rules`, or a non-strict file's local run)
stamps `"expires": { "<rule>": "YYYY-MM-DD" }` beside `rules`, a UTC date 7 days
out. After that date, an entry that still has warnings fails (exit 1) locally
and in CI alike. The message names the rule, its count, the expiry and the fix.
No run moves an existing expiry: re-running `--accept-new-rules`, a hand-raised
count and a lowered count all keep it, and only clearing the entry removes it.
The `maxWarnings` ceiling is unchanged.

A budget with no entries, the generated default, behaves exactly as before. An
entry with no expiry, written by 2.6.0 or earlier, fails in a strict file with
the exact fix command (`narduk-lint --accept-new-rules`, which stamps today plus
7), and a non-strict file's local run stamps it. A malformed date, or a date for
a rule with no entry, exits 2. `runNardukLint` takes an injectable `now` clock
for tests.

The generated AGENTS.md quality bar says that each recorded warning expires 7
days after it is recorded, and the generator release picks up the new package
pin.
