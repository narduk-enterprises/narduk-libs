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
