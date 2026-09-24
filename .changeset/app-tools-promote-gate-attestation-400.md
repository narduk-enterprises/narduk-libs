---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app deploy versions-promote` accepts `--gate-verified "<check>@<sha>"`, the promote workflow's attestation that the gate check passed on a commit (narduk-libs#400, option 2). The value splits on its last `@` and needs the full 40-character SHA. The promote refuses with `gate-mismatch` (exit 9), before touching anything, when the attested SHA is not the commit being promoted or the resolved version's `workers/tag` is not that commit. It logs the attested check and SHA and reports them as `gateVerified`. The flag is optional: without it the promote runs as before and warns that no gate attestation was passed. The generated `docs/workers-builds.md` promote excerpt and the `promote-d1.steps.yml` dry run now pass `--gate-verified "ci / Required@$VERIFIED_SHA"`.
