---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

The canonical-host redirect now always stays on the canonical origin. Before this, a raw request path such as `/.//evil.com` normalised to `//evil.com`, and the middleware resolved that as a scheme-relative URL, answering with a 308 to `https://evil.com/` (narduk-libs#444, CANON-1).
