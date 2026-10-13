---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Remove production domain routes from e2e-serve's in-memory local configuration so canonical-host redirects cannot loop. Deployment routes and canonical enforcement remain unchanged.
