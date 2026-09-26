# Package support window (N-1)

Every package this repository publishes has a stated support window. The
statement lives in one machine-readable file,
[`package-support-window.json`](package-support-window.json), and a check fails
CI when it goes out of date (narduk-libs#1034).

## The rule

When a package publishes a new major version N, the previous major N-1 still
gets security fixes and critical-bugfix backports. It keeps getting them until
every consumer that was on N-1 when N shipped has migrated to N, or for 90 days
after N is published, whichever is longer.

This is the window company-hq `docs/PACKAGE-STRATEGY.md` §2 defines for
narduk-core's breaking changes. narduk-libs#124 item 8 asked for it to be stated
for every published package. This file does that. Its `rule.id` is
`n-and-n-minus-1`, the value that `project-lifecycle.json`'s
`release.compatibility` enum already names.

## Per-package entries

Every non-`private` workspace package has one entry under `packages`:

- `{ "compatibility": "n-and-n-minus-1" }` means the rule above applies. Every
  package starts here.
- `{ "compatibility": "not-applicable", "reason": "…" }` is an explicit
  exemption, for example for a package with no consumer or only one consumer.
  The reason is required. Choosing to exempt a package is a maintainer decision
  and should be recorded in the pull request that makes the change.

Private workspace packages (`libs-explorer`, `design-system-build`) do not
publish, so they have no entry.

## Enforcement

`node scripts/package-support-window.mjs` checks the file against the workspace.
`scripts/package-support-window.test.mjs` runs the same check inside
`pnpm run scripts:test`, which the required `contracts` job and
`pnpm run preflight` both run. The check fails in any of these cases:

- a published package has no entry. The failure prints the exact line to add;
- an entry names a package that is no longer published;
- an entry uses a value other than the two above, or is `not-applicable` without
  a reason;
- the `rule` is not the N-1 window with its 90-day minimum.

So a new published package cannot land without stating its window.

## Not covered yet

- The mechanics of a backport onto an N-1 line (which branch it is cut from, and
  how Changesets publishes a lower major after a higher one) are not defined
  here. [`package-releases.md`](package-releases.md) describes releasing from
  `main` only.
- company-hq `docs/PACKAGE-STRATEGY.md` should point at this file as the
  per-package source of truth instead of describing narduk-core alone. That
  change belongs in company-hq.
- `narduk-app foundation:check`'s N-1 item reads narduk-core only. Having it
  read this file is a follow-up.
