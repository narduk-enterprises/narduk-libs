---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/narduk-timeseries': patch
'@narduk-enterprises/narduk-ai': patch
'@narduk-enterprises/create-narduk-app': patch
---

Fix request tracking after reset, duplicate subscriptions during a grace period,
and subscription keys that match Object prototype properties. Bound the analytics
response cache even when all entries are fresh. Reject fractional Influx windows,
invalid timeouts and missing window markers, and concatenate large query results
without exceeding the JavaScript argument limit.
Use UTC calendar subtraction for analytics date ranges across daylight-saving transitions.
Honor caller cancellation before AI chat requests and between retries.
Start KV cache TTLs after production and re-check expiry after asynchronous KV and D1 cache reads.
