---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Development mode now proves and reports Worker script triggers (narduk-libs#756). After `wrangler triggers deploy`, `deploy:dev` reads the live cron schedules back and ends `unproven` instead of `verified` when the declared crons are not in force. `development status --remote` shows declared-vs-live crons and routes (zone routes plus custom domains) for each component, and `development enter` reports the same mismatch at entry. A live read that fails is reported as `unknown`, never as in sync.
