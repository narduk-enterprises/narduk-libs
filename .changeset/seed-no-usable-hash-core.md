---
'@narduk-enterprises/narduk-core': patch
---

`runtime/drizzle/seed.sql` no longer ships a usable password hash: the three seeded users carry `password_hash` NULL, and the comment that named a sample password is gone. Re-running the file clears a hash an older copy wrote. An app that needs a local login registers through its own flow or stores a `hashUserPassword()` hash at seed time. A test fails if any SQL file under `runtime/` binds `password_hash` to anything but NULL or contains a `salt:hash` string.
