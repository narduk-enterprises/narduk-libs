---
'@narduk-enterprises/eslint-config': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-lint` gives every budget entry that allows a warning a 7-day expiry.
Recording an entry (`--accept-new-rules`, or a non-strict file's local run)
stamps `"expires": { "<rule>": "YYYY-MM-DD" }` beside `rules`: the record day
plus 7, in UTC. That date is the last day the warnings pass, so an entry
recorded on 2026-09-28 reads `"2026-10-05"` and fails from 2026-10-06 00:00 UTC.
From then on an entry that still has warnings fails (exit 1) locally and in CI
alike, and the message names the rule, its count, the expiry and the fix. The
`maxWarnings` ceiling is unchanged.

**Upgrading fails a strict budget that has entries.** A strict `lint-budget.json`
whose entries allow warnings but carry no `expires` date (every such file
written by 2.6.0 or earlier) fails, locally and in CI, from the first run of
this version until you run `pnpm run lint --accept-new-rules` once and commit the
result. That command stamps every undated entry with today plus 7, so those
warnings must then be fixed within the week. A non-strict file's local run
stamps undated entries itself. A budget with no entries, the generated default,
behaves exactly as before.

narduk-lint never moves an existing expiry: re-running `--accept-new-rules`, a
hand-raised count and a lowered count all keep it. The entry leaves the file
only when a whole-package run sees its rule at zero; if the rule comes back, it
is new debt with a new date. Only a whole-package run writes the budget: run
from the budget file's directory (compared on real paths), with no path but
that directory and no `--ignore-pattern`. Any other run, including a sibling
directory pointed back with `--budget`, a subdirectory, or `.` plus another
path, is narrowed: it never writes, refuses `--accept-new-rules`, and still
fails what it saw. A run with lint errors never writes either, since a file
that fails to parse hides its warnings. Package lint scripts should therefore
be plain `narduk-lint`, with any exclusions in the ESLint config.

What this cannot stop, documented in DESIGN.md: eslint-config 2.6.0 and earlier
drop `expires` whenever they rewrite the file, so a stale install strips the
dates (run `pnpm install` after pulling this bump, before linting); an ESLint
config edit that ignores the files or turns the rule off clears the entry, and
undoing it records the warnings again with a new date; a renamed rule is a new
key with a new date; and a hand edit to the file.

A malformed date, or a date for a rule with no entry, exits 2. `runNardukLint`
takes an injectable `now` clock for tests.

The generated AGENTS.md quality bar says that each recorded warning expires 7
days after it is recorded, and the generator release picks up the new package
pin.
