---
'@narduk-enterprises/narduk-app-tools': patch
---

Document a post-merge deploy assertion for apps whose Workers Build deploys
directly: a job that runs `narduk-app verify --live --expect-sha "$GITHUB_SHA"`
over a build-length wait and names the Workers Build on failure
(narduk-libs#597).
