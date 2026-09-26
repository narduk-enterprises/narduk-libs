---
'@narduk-enterprises/create-narduk-app': patch
---

`upgrade` moves a `nuxt-cloudflare.yml` caller pin forward when bundled workflows history shows it is older than this generator's pin, including pins this package did not ship itself (`9685e3d3`, `2a27d457`). A newer pin (`94a3ba46`) stays where the app put it. A SHA missing from that history is unresolved, never clean, and is not rewritten.
