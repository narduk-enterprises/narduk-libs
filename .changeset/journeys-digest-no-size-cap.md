---
'@narduk-enterprises/journeys': patch
---

The declaration digest now hashes every file under the catalog directory,
whatever its size (#118). It used to skip files of 1 MB or more without saying
so, so changing one of them left promoted captures verifying against a changed
declaration. **Digest-changing** for a catalog that holds such a file: its
promoted captures need one re-capture. A catalog without one gets the same
digest as before.
