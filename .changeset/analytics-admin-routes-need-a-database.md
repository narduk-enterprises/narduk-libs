---
'@narduk-enterprises/narduk-analytics': minor
'@narduk-enterprises/create-narduk-app': patch
---

The `/api/admin/**` GA, Search Console, Indexing and PostHog routes register
only when the app has a database: an app declaring
`nardukCore.databaseBackend: 'none'` (or `NUXT_DATABASE_BACKEND=none`) no longer
ships routes `requireAdmin` could only ever refuse. `nardukAnalytics.admin`
overrides either way (#524).
