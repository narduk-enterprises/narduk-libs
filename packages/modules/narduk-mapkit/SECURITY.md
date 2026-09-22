# Security Policy

## Reporting

Do not open a public issue for vulnerabilities, secret exposure, or suspected
credential leaks.

Use GitHub private vulnerability reporting for this repository when available,
or contact the repository owner through the private maintainer channel. Include
the affected version or commit, the impact, and a minimal reproduction that does
not contain real secrets or private data.

## Supported Versions

Security fixes target `main` and the latest published `1.x` releases of both
workspace packages. Pre-1.0 artifacts are migration-only and require consumers
to upgrade.

## Secret Handling

- Apple private keys must stay server-side in Doppler, Worker secrets, or the
  consuming platform's secret store.
- Do not pass `APPLE_PRIVATE_KEY` or `APPLE_SECRET_KEY` to browser code.
- Do not commit `.env` files, dotenv scaffolding, real tokens, account
  identifiers, production payloads, or private source data.
- If a secret is committed or exposed, rotate it first, then remove the leaked
  value from active branches and release artifacts.

## Package Security Expectations

- Do not set `allowedOrigins` or `MAPKIT_ALLOWED_ORIGINS`. Since 2.1 they are
  accepted and ignored: the token route answers same-origin requests only
  (`isMapKitRequestSameOrigin`), which no allowlist widens or narrows.
- Error responses and logs must not include private keys, tokens, or raw secret
  values.
- Tests and examples must use synthetic credentials only.
- `pnpm run quality` is the minimum local gate before release-sensitive changes.
