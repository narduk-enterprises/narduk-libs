---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

A duplicate upload of one commit is now a one-click recovery instead of a
stall until the next merge (narduk-libs#1233). Workers Builds sometimes
dispatches one trigger twice for one push, so two Worker versions carry the
same commit tag and `versions-promote` refuses with `ambiguous-version` (exit
4). Nothing in a version's metadata tells a double dispatch from a second
uploader, so the refusal stays.

`narduk-app deploy versions-promote` now accepts `--version-id` beside `--sha`,
where it used to reject the pair. Given both, it promotes the named version
only if that version is in the searched listing and its `workers/tag` is the
`--sha` commit; otherwise it exits 3 and deploys nothing. `--gate-verified`, the
production-branch check and the refusal to go older than the live version all
still apply. The `ambiguous-version` detail now lists the candidates newest
first and prints the recovery for each:
`gh workflow run promote.yml --repo <repo> --ref main -f verified-sha=<sha> -f version-id=<id>`.
A `--version-id` promote without `--sha` behaves as before.

The generated `docs/workers-builds.md` `promote.yml` excerpt takes an optional
`version-id` dispatch input. It is optional because `ci.yml`'s
`promote-dispatch` sends only `verified-sha`. The `gate` job still reads
`ci / Required` from the check-runs API, and it fails a recovery dispatch unless
`verified-sha` is main's current head and that check concluded `success`. It
passes the version to `versions-promote` as `--version-id`, alongside `--sha`
rather than in its place. The inert `docs/deployment/promote-d1.steps.yml`
takes the SHA and version from the gate job's outputs, so its dry run no longer
stops the recovery at the duplicate. It also no longer reads
`workflow_run.head_sha`, which is empty under a dispatch.

`promote.yml` is app-owned, so `upgrade` does not rewrite it. Each existing
app adds the input and gate lines from its runbook excerpt.
