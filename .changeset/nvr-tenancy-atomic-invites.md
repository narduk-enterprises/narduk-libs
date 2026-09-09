---
'@narduk-enterprises/narduk-tenancy': minor
---

Make invitation acceptance atomic across its claim, membership, optional
resource override, and audit events. Prevent concurrent invitations from
admitting two presenters, protect the last owner inside membership mutations,
and prevent revocation from racing a completed acceptance. Add optional
consumer-verified email matching without importing an authentication provider.

Atomic invitation acceptance requires the real Drizzle D1 database (`batch`) or
better-sqlite3 database (`$client.transaction`). Query-only wrappers must
forward that capability; unsupported adapters fail before claiming an
invitation.
