# @narduk-enterprises/narduk-auth

Auth, user session, protected-route capabilities, and self-service API token
management.

First-class layer package source in this workspace.

This layer now includes:

- User-session auth flows and protected auth pages
- API routes for personal API token create/list/revoke
- Shared settings UI for users to mint and revoke their own tokens
- FarmData-specific OIDC token exchange with issuer metadata and JWKS endpoints

## FarmData OIDC token broker

The module can issue short-lived FarmData access tokens without making FarmData
trust the underlying Supabase issuer. Configure these runtime bindings in the
host application:

```text
FARMDATA_OIDC_ISSUER=https://auth.example.com
FARMDATA_OIDC_AUDIENCE=farmdata
FARMDATA_OIDC_KEY_ID=farmdata-2026-01
FARMDATA_OIDC_PRIVATE_KEY=<PKCS#8 RSA private key PEM>
FARMDATA_OIDC_TOKEN_TTL_SECONDS=900
```

The module exposes `/.well-known/openid-configuration`,
`/.well-known/jwks.json`, and `POST /oauth/token`. The token endpoint requires
an existing Narduk user session and the grant type
`urn:narduk:params:oauth:grant-type:session`; it returns a token only for a
farm assigned to that user.

Administrators assign farm access with:

```text
PUT /api/admin/farmdata/users/<userId>/farms
{"farm_ids":["renz-farm"]}
```

The private key must remain in the host secret store. FarmData validates the
issuer, audience, signature, expiration, and `farm_id`/`farm_ids` claims.
