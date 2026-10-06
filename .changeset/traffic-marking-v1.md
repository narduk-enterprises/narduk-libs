---
'@narduk-enterprises/narduk-analytics': minor
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Traffic classification v1: every analytics event carries `traffic_class`
(`automation` / `owner` / `unmarked`), `traffic_evidence` and
`classification_version`, resolved before the first PostHog capture and set on
GA4 before its config command. Automation is recognised by a
`NardukAutomation/<tool>` user-agent marker; owner browsers by a signed,
origin-bound class claim that the operator portal's enrollment chain sets
through the new `GET /api/owner/enroll`. Nothing is dropped. Server captures can
use `resolveServerTrafficProperties(event)`. narduk-app-tools live probes now
append `NardukAutomation/narduk-app-tools` to their user agent.
