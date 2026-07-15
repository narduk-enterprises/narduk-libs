# @narduk-enterprises/narduk-auth

Auth, user session, protected-route capabilities, and self-service API token
management.

First-class layer package source in this workspace.

This layer now includes:

- User-session auth flows and protected auth pages
- API routes for personal API token create/list/revoke
- Shared settings UI for users to mint and revoke their own tokens

Server code imports core-owned user, session, notification, and API-key tables
through the private `#narduk-core/schema` alias registered by the core module.
Apps continue to use their app-owned `#narduk-db` alias for combined schemas.
