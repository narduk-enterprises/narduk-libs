---
"@narduk-enterprises/narduk-auth": patch
"@narduk-enterprises/create-narduk-app": patch
---

Add opt-in external runner resource support with exact owner/client policy, bounded token/grant lifetimes and a signed read-only token/grant bridge. External runner tokens cannot authenticate local application principals. Existing local-resource behavior and disabled defaults are preserved.
