---
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add opt-in browser authorization for native clients using one-time S256 PKCE
codes, rotating opaque credentials, and revocable D1 sessions. Persist optional
local email verification proof for consumers that bind invitations to verified
addresses. Existing consumers retain their current behavior until enabling the
features after applying the additive migration.
