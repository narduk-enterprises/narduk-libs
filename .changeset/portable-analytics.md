---
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Change the shared PostHog session replay default to off. Apps can continue to
opt in with `POSTHOG_SESSION_REPLAY_ENABLED=true`; the build default and Worker
runtime overlay now agree.
