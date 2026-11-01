---
'@narduk-enterprises/narduk-app-tools': patch
---

The adoption report's Dependabot alerts read now retries a connection failure (`fetch failed`) up to 3 attempts with a short backoff before the `security` check reads `unknown`, so one transient blip no longer costs a product its standing. An HTTP refusal is not retried, and a read that still fails stays `unknown` with the reason `failed to connect after 3 attempts`. narduk-libs#2143.
