---
'@narduk-enterprises/narduk-logging': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add the `./server-health` entry: a Nitro `error` hook that records unhandled 5xx
errors to D1 with stack-hash dedupe, a per-isolate throttle and a row cap; a
cron heartbeat helper (`runWithHeartbeat`); and the `jobState` staleness rule
(stale past twice the interval). Apps keep their own migrations, job names and
intervals.
