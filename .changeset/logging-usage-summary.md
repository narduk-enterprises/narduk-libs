---
'@narduk-enterprises/narduk-logging': minor
---

narduk-logging: a new `./usage-summary` entry point, the one read every app
answers so a dashboard can watch many apps the same way.
`GET /api/usage/summary` behind the app's own read-only bearer token
(`authorizeUsageSummary`, constant time, closed while unset), a range of up to
90 days (`parseUsageSummaryRange`), and `buildUsageSummary`: screens and events
by day, role and platform from `usage_counts`, sign-ins by day and role from the
app's own audit (`signInsByDay`), and errors by release from `browser_errors`
and `server_errors`. Counts only; a table the app lacks reads as empty. No other
entry point changes.
