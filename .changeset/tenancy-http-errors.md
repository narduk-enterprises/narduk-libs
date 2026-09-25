---
'@narduk-enterprises/narduk-tenancy': minor
---

Add `server/utils/tenancy-http`: `TENANCY_HTTP_STATUS`,
`TENANCY_DEFAULT_MESSAGES`, `toTenancyHttpError` and `withTenancyErrors`, so
apps stop hand-writing the `TenancyError`-to-HTTP mapping (narduk-libs#981).
The table answers `expired` with 410 and `last_owner` with 409, and never
forwards `TenancyError.message`, which embeds raw org and user ids. Options
cover per-call sentences (`messages`), existence hiding (`hideAsNotFound`) and
an app envelope (`toError`).

`requireOrgRole` and `requireSupportGrantOrRole` accept optional
`unauthenticatedMessage` and `deniedMessage`; when set, the 401 or 403 carries
the sentence as `data.message` beside the unchanged `errorCode`. Without them
the guards answer exactly as before.
