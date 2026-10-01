# @narduk-enterprises/stylelint-config

## 1.0.0

### Major Changes

- b77de55: `narduk-lint` and `narduk-stylelint` are strict: 0 errors, 0
  warnings. Logan, 2026-10-01: "lets get back to being strict in narduk
  apps.....i think we be strict 0 errors 0 warnings and see if i notice it
  again". This supersedes the 2026-09-18 warning budget (narduk-libs#531) and
  the 2026-09-28 7-day expiry.

  **Breaking for consumers.**

  - Any warning fails the run, exactly like `--max-warnings 0`, whether or not a
    budget file exists. A new warn-level rule shipped in these packages now
    turns every consumer that violates it red when it upgrades; that is the
    accepted trade-off, and there is no opt-in "next pack".
  - A `lint-budget.json` (or `stylelint-budget.json`) that still allows warnings
    (a rule or file count above 0, or a `maxWarnings` above 0) fails with a
    message to fix those warnings and delete the entries. Its entries no longer
    permit anything. An empty file passes with a notice to delete it. An app
    with `{"strict": true, "maxWarnings": 10, "rules": {}}`, the file
    `create-narduk-app` used to scaffold, must delete it.
  - Neither tool ever writes a file. `--accept-new-rules` is removed (exit 2),
    `--max-warnings` is still refused, and `--ci`, `--local`, `--no-write` and
    `--verbose` are accepted and do nothing.
  - `max-lines` yields one warning per oversize file, which a budget could not
    see grow. It now fails like any other warning.

  `create-narduk-app` stops scaffolding `apps/web/lint-budget.json` and its
  `AGENTS.md` quality bar now says 0 errors, 0 warnings. It pins the new
  eslint-config major.

  `narduk-app-tools` patch: its generated capability catalog carries the new
  `stylelint-config` description.

## 0.2.0

### Minor Changes

- 1c10b9b: Phase 1c of the libs modernize review (narduk-libs#535): narduk-ui
  ships the `--ns-z-*` page and map layer scale, moves media queries from
  620/820/1080 to Tailwind `40rem`/`64rem` (small visible layout shift in every
  narduk-ui app), and maps `--bs-*` onto `--ns-*`.
  `@narduk-enterprises/stylelint-config` is the warn-level gate with a
  ratcheting per-rule and per-file budget. Stylelint 16's
  `media-feature-name-value-allowed-list` does read range syntax, so width
  values are limited to `40rem`/`64rem`. The custom rule still names the retired
  620/820/1080 scale. libs-explorer's inventory lists the new package.
