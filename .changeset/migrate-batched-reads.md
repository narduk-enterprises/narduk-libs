---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app db migrate` starts far fewer wrangler processes (narduk-libs#704). On `--local`, every inspection read — the table list, ledger shape and rows, both legacy ledgers, the lock owner and adoption evidence — now goes to wrangler as one multi-statement `--command`, so an inspection is at most two processes whatever the history. A run that finds nothing to apply or adopt and no lock row now returns after that read, without taking the lock, and a run whose work another runner already finished skips the redundant post-apply read. Against real wrangler on a local D1 with 19 migrations, a warm (no-op) run went from 20.1 s to 3.3 s. On `--remote` a warm run drops from 15 processes to 5, and no remote path starts more processes than before: statements are still sent one per process there, because that path's multi-statement reply is not proven here. Each migration file is still applied and recorded on its own, and a retained lock still fails the run.
