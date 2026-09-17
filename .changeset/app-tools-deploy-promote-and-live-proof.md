---
'@narduk-enterprises/narduk-app-tools': minor
---

Add the promote half of the Narduk deployment standard:
`narduk-app deploy versions-promote`, `narduk-app deploy rollback`, and
`narduk-app verify --live` (company-hq#745, deployment-standard design §1.5,
§6.1–§6.3; Logan approved every recommended option on 2026-09-17).

The standard is **Cloudflare builds, GitHub promotes**. Workers Builds already
runs `wrangler versions upload` on every branch, so a push produces a version
that serves no traffic; what was missing was the half that makes one live only
after the gate check is green on that exact main SHA. `DeployAction` was
`'deploy' | 'versions-upload'` and nothing more.

**The commit-to-version link had to be built, not found.** The design's §6.1
pseudocode reads "the version whose upload annotation/commit == `$GITHUB_SHA`".
No such field exists. Read live on 2026-09-17 against the deployed `buoys`
Worker, `wrangler versions list --name buoys --json` returns only
`metadata.{created_on,source,author_id,author_email,has_preview}` and
`annotations.{workers/alias,workers/triggered_by}`; Cloudflare's Versions API
reference documents no annotation fields at all. The one commit-shaped handle a
version can hold is `annotations["workers/tag"]`, written by
`wrangler versions upload --tag`. So `narduk-app deploy versions-upload` now
stamps `WORKERS_CI_COMMIT_SHA` as the version tag when it runs inside a Workers
Build (a caller-supplied `--tag` is left alone, and nothing is added outside a
build), and `versions-promote` resolves a SHA back to a version id by reading
it. Without that stamp the promote half has no input at all.

`wrangler versions list` returns the **10 most recent** versions and takes no
paging flag, so on a busy repository a main version can fall out of the window
before the promote job runs. That is its own outcome — `version-not-found`, with
the number of versions actually searched — because the remedy differs from every
other failure.

**Its own guard.** `isWorkersBuildDeployAllowed` refuses to run anywhere except
inside a Cloudflare build, so reusing it for a promotion — which runs in GitHub
Actions — would force every release through
`NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1` and quietly license local production
deploys estate-wide. Promotion carries a separate Actions-context guard (`CI`,
`GITHUB_ACTIONS`, `GITHUB_RUN_ID`, `GITHUB_REPOSITORY`, `GITHUB_WORKFLOW`) with
its own override, `NARDUK_ALLOW_MANUAL_PROMOTE=1`.

**Rollback names its target.** A promote prints `previousVersionId`, and the
promote job feeds that to `rollback --to`. Resolving "the previous version" from
deployment history is correct exactly once: after a rollback the newest earlier
version is the broken one just left, so an unnamed second rollback would roll
_forward_ into it. The unnamed path refuses as soon as it can see the live
deployment was itself a rollback, and refuses a no-op when the target already
serves 100%.

**`verify --live` is one code path for three callers** — the preview gate, the
promote job's post-deploy proof (the auto-rollback trigger) and a human
debugging an incident. It asserts `x-build-version` (prefix compare, because 7-,
12- and 40-character spellings of one SHA all occur), `/api/health` per the
narduk-core health contract, and one app-declared smoke route, with distinct
exit codes per failure class (2 unreachable, 3 build version, 4 health, 5 smoke)
and a bounded retry over the whole pass for propagation and cold isolates. The
build-version and smoke assertions share one request.

`degraded` fails by default: §6.2 asks for both `data.status == "ok"` and "every
required check passing", and those disagree exactly in the degraded case. This
takes the literal reading; `--allow-degraded` takes the other, and never excuses
a failing **required** check.

Item 10's live header probe and `verify --live` now share one HTTP layer
(`createLiveProbe`) rather than two fetch paths with separate timeout, redirect
and user-agent behaviour. Every Cloudflare interaction is behind an injectable
seam, so no test makes a network call.
