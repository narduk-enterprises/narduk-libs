---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Read Dependabot alert continuation cursors from GitHub's Link header instead of
sending the unsupported page parameter. Preserve the repository, open
high/critical filters, 100-alert page size and ten-page ceiling. Invalid,
repeated, denied or unfinished continuation remains UNKNOWN; the reader never
forwards a token to a response-provided origin or repository. Bad-request
diagnostics no longer claim that an existing read permission was absent.
