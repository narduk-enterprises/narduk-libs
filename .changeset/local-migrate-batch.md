---
'@narduk-enterprises/narduk-app-tools': minor
---

`narduk-app db migrate --local` applies its pending migrations in one wrangler
process instead of one per migration. Each pending migration, followed by its
ledger INSERT (an adoption is its ledger INSERT alone), goes into a single
`wrangler d1 execute --local --file`, in plan order, so a cold local migrate
costs the same handful of wrangler + miniflare starts whether it carries 14
migrations or 102 (on a cold CI runner that was about 3 s per migration; 305 s
for 102). The ledger rows, their order, the checksums and the
applied/adopted/skipped accounting are unchanged.

A failing run is unchanged too. Wrangler runs a local file as one transaction,
so a failed batch records nothing; the runner then re-reads the ledger and
applies what remains one migration per call, stopping at the first failure with
every earlier migration recorded and the failing one not, and the same error. A
very large history is split into files of at most 4 MiB. `--remote` is
untouched: one file, one ledger row, the lock and the recovery snapshot per
migration, exactly as before.
