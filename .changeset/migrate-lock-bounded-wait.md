---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app db migrate` waits, bounded, for a live migration lock held by an older deploy, instead of failing at once (narduk-libs#1189). Two Workers Builds from back-to-back merges used to leave production on the older commit because the newer build's migrate failed on the older one's lock.

Under Workers Builds the lock owner now carries the commit as `<uuid>:<WORKERS_CI_COMMIT_SHA>:<committer time>`, with the time from `git log -1 --format=%ct`. The table schema does not change. A run waits only on a holder building the same commit or an earlier one. An older build never waits on a newer one (`[db] superseded: ... held by a newer commit <sha>; not waiting`), so it cannot deploy last.

- **Budget:** 300 s by default with `--workers-build-only`, and 0, the old behaviour, elsewhere. `--lock-wait-seconds <n>` or `NARDUK_MIGRATION_LOCK_WAIT_SECONDS` sets it, up to a maximum of 1200 s. It counts wall-clock waiting time only; Wrangler latency on the final read and the migration itself come on top.
- **While waiting** it prints a `waiting on another deploy (owner, since)` line, polls with backoff, and starts over from a fresh read once the lock is released.
- **These fail at once** with the unchanged `Could not acquire D1 migration lock` error:
  - a newer or same-second different commit;
  - an unknown holder, such as a bare-UUID owner from an older release;
  - a run with no commit identity;
  - a lock at least 600 s old by D1's clock;
  - the run's own uncertain insert;
  - an unreadable row or age;
  - a spent budget.

It never releases or overwrites another owner's lock.
