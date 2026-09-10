---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-seo': patch
---

Disable analytics identifiers, loading, and replay on noncanonical Workers/Pages
preview hosts and explicit nonproduction deployments. The same immutable version
keeps production analytics when promoted to its canonical hostname.

Avoid a client lifecycle warning while retaining noindex robots metadata on
noncanonical hosts.
