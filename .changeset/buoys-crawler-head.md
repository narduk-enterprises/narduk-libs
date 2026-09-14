---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Read only the parsed HTML head during social-preview crawler checks, retaining
the head byte limit and all metadata checks without downloading unrelated SSR
payloads.
