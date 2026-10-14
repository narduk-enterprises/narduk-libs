---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

`authenticateApiKey` and `authenticateD1ApiKey` rewrite `api_keys.last_used_at` at most once per five minutes per key (narduk-libs#1856). The age test is in the UPDATE's `WHERE` (`last_used_at IS NULL OR last_used_at < cutoff`), so a recently used key writes no row and costs no extra read. Every authentication used to write, about 175k rows a day in operator-portal's auth database. `last_used_at` is now accurate to five minutes; `API_KEY_LAST_USED_INTERVAL_MS` names the interval.
