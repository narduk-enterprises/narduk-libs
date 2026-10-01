---
'@narduk-enterprises/narduk-app-tools': patch
---

`narduk-app ship --adopt` now takes over a production version tagged by a
retired development-mode deploy (`dev-...`), exactly as it does an untagged one.
Any other non-SHA tag still refuses, and `--adopt` never overrides a SHA-tagged
version HEAD does not contain.
