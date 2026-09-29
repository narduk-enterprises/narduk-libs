---
'@narduk-enterprises/narduk-app-tools': patch
---

`narduk-app ship` finds the production hostname when another environment row in `Config/cloudflare-app.json` has `hostname: null`. Before, the whole manifest failed to parse and ship asked for `--base-url`.
