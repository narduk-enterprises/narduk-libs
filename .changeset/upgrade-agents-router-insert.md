---
'@narduk-enterprises/create-narduk-app': patch
---

`create-narduk-app upgrade` now appends the shipped `narduk:router` block to an
existing `AGENTS.md` that predates the markers, and leaves the rest of the file
untouched (narduk-libs#377). A missing file stays absent. An incomplete marker
pair, or a missing `narduk:e2e-policy` region, is still an opt-in notice. The
sanctioned opt-out remains a `narduk:unmanaged` header.
