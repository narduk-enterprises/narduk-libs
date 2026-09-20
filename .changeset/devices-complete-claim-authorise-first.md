---
'@narduk-enterprises/narduk-devices': patch
---

`completeClaim` checks the caller's org and resource before it reports anything
about the claim session, and before it counts the attempt (narduk-libs#533).
This is the fix #243 made to `issueApprovalToken`, applied to the completion
path it was left off.

A caller naming another org or resource now gets `unauthorized_user` whatever
state the session is in. Before, only a pending session answered that way: a
completed one answered `already_completed`, a revoked one `revoked`, an expired
one `expired` and a wrong fingerprint `hardware_mismatch`, so any caller holding
a claim session id could read another tenant's claim state.

Those refusals are also no longer counted against the owner's claim token. The
subject list was built before the org was ever compared, so five refused
cross-org attempts crossed the per-token threshold and locked the owning tenant
out of its own ceremony for the cooldown. A cross-org attempt is still counted —
against the caller's own account and IP — and the owning org's answers,
`completeClaimWithRecordedApproval`, and `not_found` for a session id that does
not exist are all unchanged.
