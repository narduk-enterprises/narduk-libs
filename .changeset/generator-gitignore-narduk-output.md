---
'@narduk-enterprises/create-narduk-app': patch
---

Fix two entries in the generated `.gitignore` that never matched what they were
meant to ignore.

`.narduk/recovery` contains an embedded slash before the trailing one, which git
anchors to the directory holding the `.gitignore` — the repository root.
`narduk-app` actually writes recovery artifacts under
`apps/web/.narduk/recovery/`, which the anchored pattern never matched, so they
landed in `git status` and could be staged by `git add -A` (narduk-libs#624,
evidence in narduk-enterprises/austin-rising-runners#3). Replaced with the
unanchored `.narduk/`, which matches at any depth.

`@narduk-enterprises/narduk-testkit` writes visual-audit artifacts to a
hard-coded `output/playwright/visual-audit`, and nothing in the generated
`.gitignore` covered `output/` even though it ignores every other Playwright
artifact root (`playwright-report`, `test-results`, `blob-report`,
`all-blob-reports`). A visual audit run left PNG output staged and invisible to
every gate (narduk-libs#630, evidence in
narduk-enterprises/austin-rising-runners#10, merge c7d3e59 committing 2.8 MB of
screenshots). Added `output` alongside the existing Playwright entries.

Neither change touches an existing app's committed `.gitignore` — only apps
generated after this release get the corrected patterns.
