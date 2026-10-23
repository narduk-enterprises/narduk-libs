---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Stop the unfurl fetcher retrying a 429 under other crawlers' User-Agents, cap the in-isolate auth rate-limit map and the SSE connection registry (registerSSE takes an optional abort signal), cancel an oversized declared-length body, keep D1 cache rows inside their stale window (cleanExpiredCache takes an optional staleWindowSeconds), stop guessing D1 for a scheduled event without runtime config, refuse an API key whose expiry is 0, make the rate-limit exemption ignore dot-segment paths, make a Set-Cookie written after a cache profile no-store, and decide fetch-header same-origin by resolving the URL so protocol-relative URLs are not marked and absolute same-origin URLs are.
