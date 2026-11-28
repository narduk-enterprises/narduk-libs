---
'@narduk-enterprises/create-narduk-app': minor
---

`upgrade` no longer writes a GitHub Packages Dependabot registry. The estate's package-read PAT was retired on 2026-11-27, so Dependabot has no credential that can read GitHub Packages. A GitHub Packages app's `.github/dependabot.yml` is now reported as `unresolved`, with the route: send the scope to `https://npm.nard.uk` and drop the `npm.pkg.github.com` tarball URLs from the lockfile. `githubPackagesDependabot` is removed.
