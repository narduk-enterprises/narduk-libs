---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`db migrate-deployment` accepts a second write context. Besides a successful
same-repository `workflow_run`, a `push` or `workflow_dispatch` on the
production branch may migrate the commit it runs on (`GITHUB_SHA` equals
`--sha`) when `--gate-verified "<gateCheck>@<sha>"` names exactly
`deployment.promotion.gateCheck` and `--gate-workflow` names the CI workflow
file, and the tool itself reads GitHub (`GITHUB_TOKEN`: `actions`, `checks`,
`pull-requests` read, on the manifest's repository only) and finds that
workflow's newest run on the commit green (check run -> check suite -> Actions
workflow run of that file, trusted event, ordered by `run_number`, never
`started_at`), or a same-repository pull request that merged as that commit with
an identical tree. A red or running newest run, a tie holding a red, any API
error, a missing token, a differing `GH_REPO`, a preview target or a bundle
refuses. `--check-context` runs that proof alone, with no Cloudflare credential
and no write; it reports a gate that is not green and fails on anything else
that would refuse a write (including an unreadable GitHub). Fixes
operator-portal#2791, where a promote workflow on `push` could never apply a
pending migration.
