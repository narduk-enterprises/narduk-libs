---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`doctor --adoption` check 5, "Packages current", gives a pin that is behind the
registry a 14-day grace (Logan, 2026-10-13). The new `behind-within-grace` row
status passes until the first release the pin is missing is 14 days old,
measured from that release's publish time in the packument `time` map and the
report's own `generated` clock; the boundary is exclusive. The clock runs from
the earliest-published missing stable release, never from `latest`, and
prereleases count only for a prerelease pin. Missing publish times fail closed
as plain `behind`. Behind rows now carry `firstMissed`, `firstMissedPublished`
and `graceDue`, and a passing check names each grace row with its due date.
`not-exact`, `disagrees`, `not-installed-as-declared` and `unreadable` are
unchanged.
