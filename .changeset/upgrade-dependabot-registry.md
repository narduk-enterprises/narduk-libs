---
'@narduk-enterprises/create-narduk-app': patch
---

`upgrade` reads `.npmrc` (a scoped registry line, then an unscoped `registry=` line, then the lockfile) before rewriting `.github/dependabot.yml`, comparing registry hosts rather than URL substrings. A GitHub Packages app is not given the `npm.nard.uk` placeholder registry, an `npm.nard.uk` app is not given a GitHub Packages registry, and a file that already targets the app's registry with an npm update block and cooldown 0 is left untouched. An unknown registry does not create a placeholder-token file.
