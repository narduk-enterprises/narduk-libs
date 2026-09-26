---
'@narduk-enterprises/narduk-app-tools': patch
---

`og:check` and `performance-budget` accept `--json <path>` the way `foundation:check` does: the path is written, and `--json` alone still prints the verdict. A missing `Config/social-previews.json` is a failed check (`ok: false`, exit 1) instead of an `ENOENT` throw.
