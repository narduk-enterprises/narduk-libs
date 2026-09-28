---
'@narduk-enterprises/narduk-seo': patch
---

The network-directory and admin OG-preview fetches now time out (5s / 10s) and fall back as they do on any upstream failure; the OG-preview failure and security.txt expiry warnings now go through the narduk-core request logger instead of `console.warn`.
