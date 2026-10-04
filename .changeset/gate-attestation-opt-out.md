---
'@narduk-enterprises/narduk-app-tools': minor
---

`narduk-app deploy versions-promote --no-gate-attestation "<reason>"` is the
explicit opt-out for a workflow that promotes without waiting for the gate on
purpose (narduk-libs#1405). The reason is logged as
`[promote] gate attestation: none, by design (--no-gate-attestation): <reason>`
in place of the missing-attestation warning, shown as `opted out by the
workflow` in the result, and carried as `gateOptOutReason` in `--json`.

- The reason is required: empty, whitespace-only, control-character or
  over-300-character reasons are a usage error (exit 2).
- Passing it beside `--gate-verified` is a usage error (exit 2).
- Nothing else changes: the production-branch check and the ordering guard apply
  as before, and a promote with neither flag still warns, now naming the opt-out.
