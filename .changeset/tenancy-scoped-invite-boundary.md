---
"@narduk-enterprises/narduk-tenancy": patch
---

Prevent resource-scoped invitations from creating or promoting organization-wide membership. Scoped acceptance now requires an existing member at or above the invited role, rechecked atomically with the claim, and only writes the resource override. Nonmembers and lower-ranked members are refused without consuming the token. Organization-wide invitations retain their existing behavior. Consumers should review organization roles granted by earlier scoped acceptances; no historical memberships are automatically changed.
