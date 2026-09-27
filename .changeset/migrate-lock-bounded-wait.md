---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app db migrate` waits, bounded, for a live migration lock instead of failing at once (narduk-libs#1189). Two Workers Builds from back-to-back merges used to leave production on the older commit because the newer build's migrate failed on the older one's lock. With `--workers-build-only` the default budget is 300 s. `--lock-wait-seconds <n>` or `NARDUK_MIGRATION_LOCK_WAIT_SECONDS` sets it, and 0 keeps the old behaviour, which remains the default elsewhere. It prints a `waiting on another deploy (owner, since)` line, polls with backoff, and starts over from a fresh read when the lock is released. A lock at least 600 s old by D1's clock, the run's own uncertain insert, an unreadable row, or a spent budget fails with the unchanged `Could not acquire D1 migration lock` error. It never releases or overwrites another owner's lock.
