---
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

PostHog now records `NardukAutomation/` browser traffic: the module sets `opt_out_useragent_filter` only when the user agent carries that marker, so posthog-js's built-in bot blocklist no longer drops our tagged Lighthouse and headless events before `traffic_class=automation` ships. Every other bot keeps PostHog's default filtering.
