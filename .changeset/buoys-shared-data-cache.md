---
"@narduk-enterprises/narduk-core": minor
"@narduk-enterprises/create-narduk-app": patch
---

Add opt-in shared edge storage and stale-while-revalidate to the published data client. Bound and checksum cached artifacts, expire manifests using an explicit write timestamp, coalesce background refreshes, and enforce a non-renewing hard age on failures. A cold isolate can reuse immutable bytes without downloading the product again; existing clients retain their defaults. Expose request-phase instrumentation so apps can keep their own timing without copying the cache implementation.
