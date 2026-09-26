---
'@narduk-enterprises/create-narduk-app': patch
---

create-narduk-app: the generated `.github/dependabot.yml` declares npm.nard.uk as a
scope-less `npm-nard-uk` registry, and the npm update lists it (#1129).
Dependabot's proxy now refuses egress to hosts the file does not declare, so a
scaffold without it got a 403 on every `@narduk-enterprises/*` lookup and
silently stopped receiving internal-package updates. The token is the
org-level `NPM_NARD_UK_PLACEHOLDER` Dependabot secret, which holds a
non-credential value; the mirror is anonymous. The entry carries no `scope:`,
which would make Dependabot discard the committed `.npmrc`. Existing apps adopt
it with `create-narduk-app upgrade . --only .github/dependabot.yml --write`.
