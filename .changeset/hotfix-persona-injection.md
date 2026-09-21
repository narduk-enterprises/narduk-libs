---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Document verified persona injection for local hotfix credentials whose
registered nVault key names differ from Wrangler's environment variable names.

Preserve runtime variables through generated Wrangler configuration so local
hotfix uploads support Wrangler 4.90.1, whose versions-upload command does not
yet accept the equivalent CLI flag.
