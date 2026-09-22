---
'@narduk-enterprises/create-narduk-app': patch
---

New apps ignore `/foundation-check/`, where the root `foundation:check` script
writes `foundation-check.json` (#652). A cold scaffold's first local run no
longer leaves an untracked directory. The artefact stays at the same path, so a
failed run can still be read. Existing apps add the line by hand; most already
have.
