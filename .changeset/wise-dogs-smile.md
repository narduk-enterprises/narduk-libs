---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Ignore stale package-manager entrypoints and fall back to the executable
installed in `PNPM_HOME`, keeping repeated migration runs independent of `PATH`.

Update generated-app package pins for the corrected app-tools release.
