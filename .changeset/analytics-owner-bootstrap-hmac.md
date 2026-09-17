---
'@narduk-enterprises/narduk-analytics': patch
---

Stop serving `POSTHOG_OWNER_DISTINCT_ID` to anyone who forges
`narduk_owner=true`.

`GET /api/owner/posthog-bootstrap` now requires the httpOnly HMAC proof cookie
minted by `POST /api/owner-tag` (`OWNER_TAG_SECRET` via `crypto.subtle`). The
unsigned `narduk_owner` flag stays client-readable for `posthog.client`.
Clearing the tag deletes both cookies. Bootstrap uses the existing owner-tag
rate-limit policy.

The proof is `iat.hex(HMAC-SHA256(secret, narduk-owner-proof:v2:iat))`. Verify
is constant-time on the signature, fail-closed when the secret is missing, and
rejects a token older than `OWNER_PROOF_MAX_AGE_SECONDS` (one year).

`POST /api/owner-tag` now compares the submitted `OWNER_TAG_SECRET` with the
same constant-time helper instead of `!==`, so the mint path no longer exits on
the first differing byte. The helper compares length first, so it hides the
secret's contents but not its length.

## Operator action

Old-format proofs (the static 64-hex HMAC of `narduk-owner-proof:v1`) are
rejected. Owner devices must re-run `POST /api/owner-tag` once to mint a v2
proof cookie. `OWNER_TAG_SECRET` rotation remains the emergency kill.
