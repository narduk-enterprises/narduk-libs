---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app doctor --audit` is the doctor's dependency-audit leg (#376). One `pnpm audit --json` call, cached per `pnpm-lock.yaml` hash for up to 12 hours, gives one verdict line. It FAILs only on a high or critical advisory that the app has not accepted in `narduk-app.json` `security.acceptedAdvisories` (`{ "id", "reason", "expiresOn"? }`), and it prints the line to paste, saying first when a patched version makes the bump the fix. Low and moderate advisories never count. An unreachable registry or a missing lockfile is UNKNOWN and exits 0, an expired `expiresOn` is a WARN, and a declaration that no longer matches is a "remove this entry" note. Bare `doctor` is unchanged. `create-narduk-app` scaffolds `narduk-app.json` with an empty list and adds a how-to section to the app README.
