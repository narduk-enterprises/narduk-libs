---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

Closed signup can no longer be bypassed by exchanging a self-signup confirmation token as `type=invite`. An exchange now counts as an invite only when the verified Supabase user has `invited_at` set, which GoTrue records only when an operator invites someone. A client-chosen `type` or a stored PKCE `redirectType` is no longer enough.
