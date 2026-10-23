---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Reject backslash and control characters in normalizeDemoRedirectPath, match the hard-coded /api/owner-tag CSRF skip without its query string, return 404 when a local cdn-cgi image path dot-segments out of /_og/, and pin the 192.0.0.9/.10 SSRF exception with a comment and table test.
