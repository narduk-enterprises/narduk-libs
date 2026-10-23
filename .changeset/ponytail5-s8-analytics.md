---
'@narduk-enterprises/narduk-analytics': patch
---

Google admin routes now pass the upstream status of a `GoogleApiError` through, instead of answering 500. The PostHog referrer report marks `$direct` as unknown. IndexNow submit points `keyLocation` at the key file this package serves, accepts at most 10,000 URLs, and reports 0 submitted when every engine rejects the batch.
