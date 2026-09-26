---
'@narduk-enterprises/create-narduk-app': patch
---

`upgrade` reads `.npmrc` (then the lockfile) before rewriting `.github/dependabot.yml`. A GitHub Packages app is not given the `npm.nard.uk` placeholder registry, an `npm.nard.uk` app is not given a GitHub Packages registry, and a file that already targets the app's registry with cooldown 0 is left untouched.
