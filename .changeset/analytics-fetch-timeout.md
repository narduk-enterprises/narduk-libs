---
'@narduk-enterprises/narduk-analytics': patch
---

Outbound Google, PostHog and IndexNow calls now time out (10–30s) instead of waiting indefinitely; a timeout surfaces through the same error path as a network failure.
