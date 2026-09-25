---
'@narduk-enterprises/narduk-app-tools': patch
---

Make development mode survive a GitHub repository rename. The client resolves the
origin-named repository once through `GET repos/{owner}/{name}`, which follows a
rename, to its canonical name and numeric id. `development exit` now accepts a
validation run whose repository and head repository carry that id, where it used
to reject every run of a renamed repository by comparing full names. Workflow
holds, restores and run cancellations address the canonical name, so no write
goes through a redirect. Activation records, receipts and validation history keep
the key they were created under.
