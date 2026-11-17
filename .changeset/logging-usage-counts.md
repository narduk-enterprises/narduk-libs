---
'@narduk-enterprises/narduk-logging': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-logging: a new `./usage` entry point for first-party usage counts. An app
counts screen opens and named events in the browser (`createUsageReporter`,
`createUsageSender`, `installUsageFlush`) and stores sums by day, role and
platform in its own D1 (`USAGE_COUNTS_DDL`, `parseUsageBatch`, `recordUsage`,
`listUsage`, `usageTotals`, `pruneUsage`). Nothing about a person is kept: no
user or session id, no IP address, no query string, no free text; the server
sets the day and the role. No other entry point changes.
