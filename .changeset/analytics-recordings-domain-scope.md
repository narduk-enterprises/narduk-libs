---
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

Scope admin PostHog session recordings to `POSTHOG_DOMAIN` so a shared project cannot list another app's replays, and include the domain in the recordings cache key.
