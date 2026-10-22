---
'@narduk-enterprises/narduk-auth': patch
---

Security fixes: deleting a local account with no password (Sign in with Apple, magic link) now requires a sign-in within the last 10 minutes; completing a password reset revokes the user's other sessions before writing the new hash; the MCP bearer guard covers both the `/mcp` and `/mcp/` spellings, whichever one `resourcePath` is configured with; an MCP token exchange the library refuses (for example a wrong PKCE verifier) releases its one-time code claim so the real client can still redeem it.
