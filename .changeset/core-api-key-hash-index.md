---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Core migration `0007_api_key_hash_index.sql` adds a unique index on
`api_keys.key_hash` (#168). Every API-key authentication looks the key up by its
hash, and without the index each one scanned `api_keys`, including a request
presenting a well-formed but fabricated key. The D1 and Postgres schemas declare
the same index. Apply it with the app's migrate script
(`narduk-app db migrate`). A Postgres app adds it with its own DDL.
