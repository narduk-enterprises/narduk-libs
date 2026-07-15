---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Run Wrangler through the package manager entrypoint that launched `narduk-app`,
avoiding PATH-dependent migration failures on repeated CI invocations.

Update generated-app package pins for the corrected app-tools release.
