# Review of cloudflare/security-audit-skill

Reviewed commit `c1c8a8c` (shallow clone of `main` on 2026-10-22). Validators:
`validate-coverage-ledger.test.cjs` 31/31 pass, `validate-findings.test.cjs`
34/34 pass, run locally with Node. This note is the parent's review. It is not a
finding record.

## What the skill is

A full audit is six ordered phases: reconnaissance, coverage-led hunting,
independent candidate validation, schema-checked `findings.json`, a second fresh
verification of the records, and a report derived only from those records.
Guidance mode is the default. Full mode starts only on an explicit audit,
pen-test, or report request. This session is full mode against `narduk-libs`.

The evidence bar is the part worth keeping. `confirmed` needs a source trace and
a bounded observed result, and it is the only verdict with severity.
`needs_validation` is a blocked hypothesis with an exact missing fact and no
severity. `rejected` records a disproved claim so a later run does not treat it
as coverage. Defense in depth, checklist misses, and same-principal actions are
not findings. The hunter, the candidate verifier, and the record verifier are
different agents. The parent alone writes the shared files.

The coverage ledger is a sorted array of canonical IDs. Each ID is RFC 3986
percent-encoding of the surface, boundary, subsystem, attack class, and optional
lifecycle, joined by `::`. The validator rejects duplicate IDs, two IDs for one
semantic tuple, unsorted units, unsafe paths, local checks without a
parent-promoted artifact, and evidence copied across reassignment waves. The
findings validator rejects severity above demonstrated impact, duplicate
fingerprints, and unsafe paths. Both CLIs refuse symlinks, FIFOs, invalid UTF-8,
and over-deep JSON without echoing parser-controlled text. That is real
hardening, and the tests exercise it.

Companion files are selected because a trust boundary is visible in source, not
because a dependency name appears. Prior runs are additive. A previous
`confirmed` record carries forward only when the relevant source is unchanged,
and it still goes through the current verifier. A `quick` or scoped ledger never
implies the rest of the tree is fine.

## Where it strains on this repo

The deep profile asks for a unit per material combination of surface, boundary,
subsystem, attack class, and lifecycle, and it forbids silent thinning.
`narduk-auth` alone has dozens of routes and several lifecycles. A faithful
expansion meets the validator's 5 MiB practical cap before the hunt starts. The
skill gives `quick` a coarsening rule and gives `deep` no unit budget. This run
seeded 34 assigned units plus one `not_applicable` memory-safety unit, in
priority order, and says so. That is a cut, not complete deep coverage.

Every hunter prompt is specified to contain the architecture, the assignment,
the ordinary blocks, the companion sections, the promotion procedure, and the
schema branches, copied verbatim. On six lanes that is more text than a useful
hunt can carry beside the source. This run pinned the skill commit and had each
hunter read those files from disk. The deviation is recorded here. The skill
needs an include-by-hash so a parent can bind a block without pasting it.

`confirmed` is unreachable unless the host can prove one OS sandbox with no
external network, an empty allowlisted environment, a read-only target and
toolchain, scratch-only writes, and explicit resource limits, plus the no-follow
descriptor promotion procedure. This Mac session cannot prove that set. Target
code was not executed. Candidates that need a runtime result stay
`needs_validation`. A parent under pressure to "confirm" something will violate
the skill. The skill should say that a source-only run's terminal state is a
validated `needs_validation` set, not an empty `confirmed` set dressed up as a
clean bill.

HUNTING.md describes `blockers` as objects with a kind. `report-schema.json`
says they are strings. The promotion procedure is copied in three places. Those
will drift. The schema wins for this run.

"Obvious things" tells the hunter to check the lockfile for known CVEs. The
execution rules forbid contacting a registry. The skill does not resolve that.
This run does not query an advisory database. A floating pin can be a source
finding. A CVE number cannot.

The skill is written for an application with a lower-trust principal. A
published library's caller is often the application developer, the same
principal the helper serves. Without that sentence, hunters report "the caller
can pass a malicious string" as a boundary failure. This run states the rule in
`architecture.md`. The skill should state it for libraries, CLIs, and
generators.

The workflow does not fit an estate job lane that is expected to open a pull
request. Hunters must not edit the target. In-session read-only subagents match
the parent and hunter split. `master-program` already excludes a read-only
fan-out from a portal board, so this run did not open one.

Line-numbered traces are right for one commit and stale on the next. The
prior-run rules handle that, at a cost the first run does not show.

## What to keep using

Use the verdict split, the ledger validator, the same-principal rule, and the
ban on live probes. Do not use a green ledger as a claim that the monorepo was
fully hunted. Do not promote a `needs_validation` record to a severity. Do not
paste exploit procedures into `execution` or `validation_plan`.

## Skill test evidence

- `node validate-coverage-ledger.test.cjs`: 31 pass, 0 fail
- `node validate-findings.test.cjs`: 34 pass, 0 fail
- `node validate-coverage-ledger.cjs` on this run's seeded ledger: PASS, 35
  units

## Run outcome

The partial deep run against `narduk-libs` commit
`212392aa61537e5fd7ccce842e5a17f2e832e3d6` finished at 2026-10-22 16:52 CT
(21:52 UTC). Report: `~/security-audit-skill/narduk-libs/run-1/REPORT.md`. Final
ledger PASS, 39 units. Findings PASS: 0 confirmed, 2 needs_validation, 1
rejected. Local execution stayed blocked, so `confirmed` stayed unreachable. The
phase-2 critic was the parent. Phase 3 and phase 5 used fresh scoped verifiers.
