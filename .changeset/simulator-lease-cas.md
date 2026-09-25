---
'@narduk-enterprises/journeys': patch
---

Make taking over a stale simulator lease compare-and-swap. Takeover, renew and
release now run under an exclusive `<udid>.json.lock` and re-read the lease
inside it, so two lanes that both saw the same expired or dead-pid lease can no
longer both return a lease for one simulator. A lane that meets the lock refuses
at once and names the lock's pid and path.
