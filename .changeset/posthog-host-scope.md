---
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

The admin PostHog pages, devices, entry-exit, referrers and insights routes now scope the shared project to this app by host: the `$current_url` host must equal the configured domain's host or be a subdomain of it, the same test recordings uses. A `$current_url` substring match used to count any app whose host contains this one, and any URL carrying the domain in its path or query. With no domain configured these routes now return no data, as recordings does, instead of dropping the filter and returning every app's traffic (#924). `buildPosthogCurrentUrlClause` returns `AND false` for a blank domain, and the new `buildPosthogCurrentUrlHostMatch` gives the bare HogQL expression.
