---
'@narduk-enterprises/narduk-core': patch
---

Stop the `security.headers` CSP report sink from logging `blockedUri: "[invalid URL]"` for every violation whose blocked-uri is a keyword rather than a URL (narduk-libs#1402). narduk-logging treats any field whose key ends in `uri` as a URL, so `eval`, `inline`, `data`, `blob`, `self` and the like all collapsed into one string. They are now logged verbatim under `blockedKind`; a real URL still goes out as `blockedUri` with its query and credentials stripped.
