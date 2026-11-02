---
'@narduk-enterprises/create-narduk-app': minor
---

Stagger Dependabot across the quiet-hours window. The generator and `upgrade` derive each app's weekly day and time from a hash of its name (Mon-Fri nights, 22:00-05:45 America/Chicago, 15-minute steps) instead of pinning every app to Monday 06:00. `upgrade` treats a file whose day or time is not the app's slot as drift and rewrites it; a `# narduk:dependabot-schedule day=<day> time=<HH:MM>` comment is an explicit per-repo slot that `upgrade` keeps.
