---
'@narduk-enterprises/create-narduk-app': patch
---

`upgrade` now appends the `narduk:router` block to an existing `AGENTS.md` that has no markers, instead of reporting it unmanaged. The rest of the file is untouched, and a `<!-- narduk:unmanaged -->` header still opts out. The block also names the app's shared `@narduk-enterprises/*` packages and points at `narduk-app doctor` and `create-narduk-app upgrade`. A file with only one marker of the pair is reported `unresolved` and left alone (narduk-libs#377).
