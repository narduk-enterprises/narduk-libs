---
'@narduk-enterprises/narduk-tenancy': minor
---

Index the org-scoped membership ordering and the pending-invite predicate.

A new `drizzle/0002_org_list_indexes.sql` adds three
`CREATE INDEX IF NOT EXISTS` statements for the two list reads a consuming app's
org console issues. Neither read was a full table scan before -- `0001` already
narrows to one org -- but both paid for everything the org had accumulated
rather than for what they returned: a 200-member page read and sorted every
membership in the org, and the live-invite list and its `count(*)` read every
invitation the org had ever issued, accepted and revoked rows included.

Measured by rows visited, a member page now costs 201 reads whether the org has
200 members or 5 000 (was 200, 1 000 and 5 000), and five live invitations cost
five reads whether 0, 50 or 500 accepted invitations sit behind them (was 5, 55
and 505).

Additive and `IF NOT EXISTS` throughout, with no down-migration, so an app
already carrying these indexes in its own migration finds them present rather
than duplicated.
