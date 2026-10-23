---
'@narduk-enterprises/narduk-tenancy': patch
---

`removeMember` and `setMemberRole` now write the membership change, its overrides and its audit row in one batch, so a failed second statement no longer leaves a half-applied change.
