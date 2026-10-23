---
'@narduk-enterprises/narduk-timeseries': patch
---

In-flight series resolves are keyed by JSON instead of a joined string, `bucketReadings` ends a bucket at the last instant that still has its wall-clock key (Pacific/Chatham fall-back) and skips time strings with no offset, and a retention policy refuses a vessel on two track tiers.
