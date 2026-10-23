---
'@narduk-enterprises/narduk-auth': patch
---

The MCP OAuth token request now purges a bounded batch of the oldest expired `auth_oauth_kv` rows instead of every expired row. Account deletion for a principal with no backend stamp now uses the Supabase password check when either the build config or the running Worker's `AUTH_BACKEND` says Supabase.
