---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Foundation item 11.3 no longer fails a job that calls a shared workflow with no
Node input, such as `cursor-review.yml`. It no longer tells a caller of a
`node-version`-only callable to use `node-version-file`, an input that callable
does not declare; 11.1 still holds that caller's literal to `.node-version`.
Workflows are also evaluated per job, so one job's `node-version-file` no longer
satisfies another job in the same file.
