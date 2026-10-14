---
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/create-narduk-app': patch
---

Normalize the unconfigured network directory robots header before prerender export, so Cloudflare receives one noindex header rather than two differently cased copies.
