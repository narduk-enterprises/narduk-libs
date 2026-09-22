---
'@narduk-enterprises/narduk-logging': patch
---

Test configuration only (#605): adapter tests that boot a real host get a 20 s
budget instead of vitest's 5 s default. Nothing in the published package
changes.
