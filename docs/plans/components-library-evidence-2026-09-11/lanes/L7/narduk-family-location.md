# narduk-family-location — component-usage survey (L7)

**Clone failed: repository does not exist.**

`gh repo clone narduk-enterprises/narduk-family-location` failed with:
`GraphQL: Could not resolve to a Repository with the name 'narduk-enterprises/narduk-family-location'. (repository)`

Confirmed via `gh repo view narduk-enterprises/narduk-family-location` (same
error) and a full scan of both orgs:
`gh repo list narduk-enterprises --limit 300` (52 repos, no `famil`/`locat`
match) and `gh repo list narduk-incubator --limit 300` (no match either).
`gh search repos "family-location" --owner narduk-enterprises --owner narduk-incubator`
also returned `[]`.

Per the lane brief: skipped, not falling back to a local checkout, no survey
performed.

This looks like a repo-inventory discrepancy in the audit's repo list rather
than something fixable from inside this lane — worth the orchestrator
double-checking whether this app was renamed, not yet created, or lives under a
different org/name before folding L7's results into the estate-wide plan.
