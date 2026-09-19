---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Refuse an existing D1 application schema with no recorded migration history,
even when a source manifest contains no SQL. Require reviewed baseline evidence
instead of reporting an untracked read model current or replaying its schema.
