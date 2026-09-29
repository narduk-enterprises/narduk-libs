---
'@narduk-enterprises/narduk-app-tools': minor
---

Add `narduk-app ship`: one command from a committed feature branch to a proven production deploy (concurrent check + build, artifact gate, upload, promote, live proof, automatic rollback, auto-merge PR), with no development-mode custody. `deploy versions-promote` now refuses (exit 10, `ship-not-contained`) to promote a commit that does not contain the shipped version production serves.
