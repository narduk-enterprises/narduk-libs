-- Indexes for the two org-console reads a consuming app issues against the
-- tenancy tables (narduk-libs#229). Neither is a query this package makes:
-- narduk-tenancy owns the schema, so it owns the schema's indexes, and a
-- consumer should not have to carry them per app.
--
-- Additive `CREATE INDEX IF NOT EXISTS` only, like 0001, so re-running is safe
-- and a consumer already carrying these verbatim in its own app-owned
-- migration finds them present rather than duplicated. There is deliberately
-- no down-migration.

-- 1. Ordered, paged membership reads:
--      WHERE org_id = ? ORDER BY created_at, user_id LIMIT ?
--    `tenancy_memberships(org_id, user_id)` is the primary key's shape, not
--    this ordering, so without this index SQLite sorts the org's whole
--    membership set on every page.
CREATE INDEX IF NOT EXISTS tenancy_memberships_org_created_at_idx
  ON tenancy_memberships(org_id, created_at);

-- 2. Ordered, paged invite reads, the same shape.
CREATE INDEX IF NOT EXISTS tenancy_invites_org_created_at_idx
  ON tenancy_invites(org_id, created_at);

-- 3. The pending-invite predicate:
--      WHERE org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
--        AND expires_at > ?
--    SQLite treats `IS NULL` as an equality constraint, so the leading three
--    columns narrow to one org's live invitations before the range check on
--    `expires_at`. Without it both the list and its count(*) walk every invite
--    the org has ever issued, accepted and revoked rows included -- cost that
--    grows with retained history rather than with the live working set.
CREATE INDEX IF NOT EXISTS tenancy_invites_org_pending_idx
  ON tenancy_invites(org_id, accepted_at, revoked_at, expires_at);
