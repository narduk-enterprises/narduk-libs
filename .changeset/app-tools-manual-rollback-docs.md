---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Correct `docs/deployment-migrations.md` on rollback. It said a promote workflow
may run `narduk-app deploy rollback` automatically after failed live proof.
The deployment standard declares `deployment.rollback.mode: manual` and
sub-check 12.10 fails `"auto"`, so no promote workflow rolls back on its own.
The failed run prints the version production left and the command, and a
person runs it. Documentation only; no behavior changes. create-narduk-app
moves with the narduk-app-tools pin.
