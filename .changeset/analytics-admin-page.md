---
'@narduk-enterprises/narduk-analytics': minor
---

Add the in-app admin Analytics page at `/admin/analytics` (opt out with `adminPage: false`). It reads one app's own PostHog, GA4 and Search Console data: range presets 1h to 30d plus a validated custom range, a local/UTC timezone toggle, an External (default) or Include internal traffic filter that reads `properties.traffic_class`, KPIs, a bar/trend/table chart with hover, tap and keyboard detail, origins, tracking health, top/entry/exit pages, devices and Search queries/pages. Sources that cannot answer say "Not measured" rather than showing zero, Google is daily only and stamped when stale, and a blank referrer is unknown rather than direct. New admin routes: `posthog/overview`, `posthog/health`, `posthog/origins`; `pages`, `devices`, `referrers` and `entry-exit` accept the shared range/timezone/traffic query. No deploy markers are drawn because there is no release source.
