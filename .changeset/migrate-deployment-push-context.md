---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`db migrate-deployment` accepts a second write context. Besides a successful
same-repository `workflow_run`, a `push` or `workflow_dispatch` on the
production branch may migrate the commit it runs on (`GITHUB_SHA` equals
`--sha`) when `--gate-verified "<check>@<sha>"` names the gate and the tool
itself reads that check from GitHub (`GITHUB_TOKEN`, `checks: read`,
`pull-requests: read`): green on the commit, or on a same-repository pull
request that merged into the production branch as that commit. A red newest run
on the commit, any API error, a missing token, a preview target or a bundle
refuses. `--check-context` runs that proof alone, with no Cloudflare credential
and no write; it reports a check that is not green and fails on anything that
would refuse a write otherwise (including an unreadable GitHub). Fixes operator-portal#2791, where a promote workflow on `push`
could never apply a pending migration.
