---
'@narduk-enterprises/journeys': patch
---

The simulator control's `pid()` matches the app's whole `launchctl` label, so
`com.narduk.stonx` no longer picks up the pid of `com.narduk.stonx.watchkitapp`
or `com.narduk.stonx-beta`.
