---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-data client: opt-in `trustValidatedStoreHits: { mark }` skips the schema
walk on a store hit this build already validated (#1370). On `store.put` the
client writes `x-narduk-validated: <mark>` only when the schema returned its
input structurally unchanged; on a hit whose header equals `mark` and whose
checksum verifies, it returns the decoded JSON without running the schema
(`validate` still runs). An upstream read, a missing or different mark, a
prefetched copy and a schema that strips or transforms keys all validate as
before, and a hit another build marked is re-marked after a clean parse. Off
unless the option is set; an empty or non-header-safe `mark` leaves it off.
create-narduk-app: pin the new narduk-core.
