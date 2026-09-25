---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core: keyset cursors for cursor-mode list routes (narduk-libs#987). New
explicit export `@narduk-enterprises/narduk-core/server/list-cursor`:
`encodeListCursor` renders a versioned base64url cursor bound to the route's
endpoint, sort and hashed `bind` values; `readListCursor` / `decodeListCursor`
read it back and refuse any mismatch with one `400 cursor_invalid`; and
`keysetAfter` is the tie-safe seek predicate
(`(a > ?) OR (a = ? AND b > ?) ...`) that stops rows sharing a timestamp from
being skipped across a page boundary. Nothing is auto-imported.
