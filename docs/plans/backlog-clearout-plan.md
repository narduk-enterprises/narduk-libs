# narduk-libs backlog clear-out — execution plan

> Supersedes the 2026-09-20 Codex proposal. That proposal's triage is carried
> forward; its eight-lane model, merge queue, and release-gate relaxation are
> not. Logan's decisions of 2026-09-20 are recorded verbatim in § Decisions.

## Measured baseline (2026-09-20, do not re-derive)

Everything below was measured live. It is the evidence the plan's shape rests
on, so a later session can challenge the plan without re-running the survey.

| fact                                 | value                                                                  | how                                    |
| ------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------- |
| open issues                          | 190 (1 P0 / 43 P1 / 124 P2 / 24 P3)                                    | `gh issue list --state open`           |
| issues with no milestone             | 190                                                                    | same                                   |
| `ci.yml` success p50 / max           | **4 min** / 10 min                                                     | last 200 runs, since 2026-09-18T20:34Z |
| `ci.yml` conclusions                 | 138 success, 39 cancelled, 17 `action_required`, 6 failure, 20 reruns  | same window                            |
| PR open→merge, median                | **25 min** (last 25 merged)                                            | `gh pr list --state merged`            |
| merged PRs/day                       | 34 / 37 / 30 / 19 on 09-17 … 09-20                                     | same                                   |
| issues opened vs closed, 09-17…09-20 | **150 opened, 63 closed (+87)**                                        | `gh issue list --state all`            |
| issues filed in the last 7 days      | **117 of 190**                                                         | same                                   |
| issues untouched >14 days            | 9                                                                      | same                                   |
| runners                              | `ubuntu-latest` everywhere; repo is public, so hosted minutes are free | `.github/workflows/*`                  |
| required contexts on `main`          | `ci / Required`, `verify` (ruleset `require-ci-required`)              | `gh api .../rulesets`                  |

Two conclusions follow, and they set the plan's priorities:

1. **CI is not the constraint.** 4 min p50 against a 25-minute median lead time
   means CI is ~16% of a PR's elapsed life. The remaining 84% is authoring,
   review, approval waits, and merge ordering.
2. **In-flow is the constraint.** Throughput is already 30+ PRs/day. The queue
   grows because each merge and each review manufactures follow-ups faster than
   it drains, and 117 of 190 issues are under a week old. This is a freshly
   generated backlog, not a rotting one.

## Decisions (Logan, 2026-09-20, verbatim)

- Execution: _"Let's do 4 lanes at a time, Opus 5 High or below erring on the
  side of caution"_ — supersedes the same day's inline/no-lanes directive for
  this campaign.
- CI redesign: _"Drop it; keep only scoped consumer + preflight"_.
- Scope: _"Freeze the milestone, keep filing freely"_.

## Phase 0 — freeze the scope — **DONE 2026-09-20 22:56Z**

One milestone, `backlog-clearout`, carrying exactly the 190 issues open on
2026-09-20. Filing stays unrestricted; new issues simply land **outside** the
milestone unless they are P0, a security defect, or release-blocking, in which
case the orchestrator admits them explicitly.

Executed: milestone
[#1](https://github.com/narduk-enterprises/narduk-libs/milestone/1) created at
2026-09-20 22:56Z and stamped onto all 190 issues open at that instant. Verified
server-side afterwards: milestone `open_issues=190 closed_issues=0`, the
milestone's member set diffs empty against the freeze snapshot, and no open
issue in the repository lacks a milestone. The admission rule is recorded in the
milestone description and in `AGENTS.md` § Backlog clear-out freeze, so a filing
agent sees it without reading this plan.

The campaign is done when that milestone reaches zero. Raw open-issue count is
not the measure — with filing left open it will not fall, and that is expected.

### Amendment — findings fold in, waves recalibrate (Logan, 2026-09-20)

Verbatim: _"And as new issues are found along the way they should be folded into
the work if they are easy or a new issue filed if they are larger, and we should
recalibrate the waves to include the new issues as we owrk the backlog"_.

So the freeze bounds the **measurement**, not the work:

- A small defect a lane finds inside the area it is already changing is fixed in
  the same PR, named in the body, and never filed.
- A larger or out-of-scope finding is filed, labeled, milestone unset, and the
  lane keeps moving.
- At **every wave boundary** the master reviews everything filed since the
  freeze, admits what belongs into the milestone (saying so on the issue), and
  rewrites the lane queues. Phase 1's close is the first such boundary.
- Two counters are kept apart: the baseline 190 drained, and the count admitted
  since the freeze. Without that split, a campaign that absorbs its own
  discovery has no definable end.

## Phase 1 — mechanical re-verify sweep (first, before any implementation)

The single largest wall-clock win, and it needs no CI, no merge order, and no
lane isolation. 117 issues are under a week old against a codebase taking 30+
PRs a day; the already-fixed fraction is large and unknown.

Every milestone issue gets one probe against current `main` and the currently
published package version, and lands in one terminal state:

| state              | meaning                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `fixed`            | reproduction no longer reproduces; closed with the proving command |
| `superseded`       | a live issue or landed PR covers it; closed pointing at it         |
| `externally-owned` | belongs to a consumer repo; transferred with a link                |
| `deferred`         | real but out of campaign scope; a named replacement tracker        |
| `active`           | survives the probe; keeps its lane assignment                      |

Probing is Sonnet work. **Closure decisions stay with the orchestrator** — a
probe produces evidence, not a verdict. Known starting points, all verified as
still open today:

- **#577 closes now.** Its premise was "always-red, Cursor quota exhausted". The
  last 20 `cursor-review` runs are 14 success / 2 cancelled / 4
  `action_required`, zero failures.
- **#544 / #561 / #631** are three filings of the same
  `foundation:check:toolchain` 11.3 shared-workflow-caller false positive.
  Canonicalize the **oldest** (#544) — inbound references and the discussion
  history are there — and close the other two as duplicates.
- Re-verify and probably close or re-scope: #124, #126, #317, #417, #454, #558.
- Combine: #513 into #606; #492 into #619; #169 with #540 once #542 releases.
- Convert to reporting-only trackers with executable children: #57, #76, #124,
  #125, #126, #171, #247, #444. A tracker must not compete with its own children
  in the active queue.

## Phase 2 — the two CI items worth doing

Everything else from the original Phase 1 is dropped: no merge queue, no
protected-main ruleset change, and **no change to `verify-release-ci.mjs`**.
That gate currently requires the exact release SHA to carry a `push`-event
`main` run with exactly one successful `verify` aggregate on that attempt;
accepting a merge-group proof for a matching tree would trade publication
integrity (tree equality is not commit equality) and re-open the release-commit
cancellation race that `ci.yml`'s concurrency expression was written to prevent
— for roughly four minutes per release. Not worth it, and on a public repo the
duplicate runs a queue would eliminate cost nothing.

1. **Scoped packed-consumer.** Teach the planner and
   `prepare-packed-consumer.mjs` an explicit package scope: an isolated package
   change packs only that package plus its workspace dependency closure.
   Generator, lockfile, root-tooling and workflow changes keep the full
   all-package generated-consumer proof. Add a scheduled all-package run so
   packages outside the current closure stay exercised.
2. **Local preflight.** One non-writing command that reproduces the PR fast
   path: diff against `origin/main`, print the affected-package and
   consumer-proof plan, run contracts, run the selected package gates, run
   artifact-only consumer proof where applicable. It must not modify tracked
   files — `narduk-lint` already rewrites `lint-budget.json` during `quality`
   (#623), which is exactly the failure this command must not repeat.

**Also fix the approval latency.** 17 of 200 CI runs sat in `action_required`,
and the changesets release PR hits it every time. That is human-latency wall
clock the original plan never named, and it is a larger win than the queue it
proposed. Logan's standing authorization (2026-09-12) is to approve
`action_required` runs in narduk-libs without asking; the orchestrator does so
on sight, and the lane that notices one reports it rather than waiting.

## Phase 3 — four concurrent lanes, two waves

Four slots at a time. Cap is **Opus 5 (high)**; go lower only where the work is
genuinely mechanical, and err toward the higher tier when in doubt. Each lane is
file-disjoint, owns its whole lifecycle (implement → PR → gate → merge), and
reports rather than streams.

### Wave A — stabilization and safety

| slot | lane                                 | issues                                                                                                   | tier        |
| ---- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------- |
| A1   | Release & CI reliability             | #619/#492, #628, #623, #634, #605, #606/#513, #544 (canonical), #577, #162, #198, #400, #470, #489, #453 | Opus 5 high |
| A2   | Security, auth, tenancy, devices     | #533, #213/#537, #620, #399, #600, #125/#164/#165/#168                                                   | Opus 5 high |
| A3   | Generated apps & adoption tooling    | #309, #61, #630, #637, #624, #468, #307, #241, #625, #568, #498, #508/#509, #516, #632, #638             | Opus 5 high |
| A4   | Core runtime, caching, HTTP, logging | #435, #493, #462, #416, #404, #49, #156, #169/#540, #514, #325, #208                                     | Opus 5 high |

Ordering inside each lane:

- **A1** — release baseline correctness first (#619/#492: `release-plan:check`
  diffs against local `main`, so a stale worktree invents a changeset cascade),
  then make local `quality` match CI (#628, #623), then the retry-warning false
  reds (#605, #606/#513).
- **A2** — cross-org claim isolation (#533) → actor rank enforced _inside_ the
  write (#213/#537) → explicit forked compliance state (#620) → expand-only
  migration rule (#399) → the dropped-cited-table trap (#600) → API-key and
  passkey persistence (#165, #168). Each needs an adversarial test and, where
  applicable, one real consumer proof.
- **A3** — correct the foundation-check semantics _before_ fixing what they flag
  (#632 and #638 gate the rest), then a fresh scaffold passing its own checks,
  then non-destructive upgrade, then registry-auth and rate-limit generation.
- **A4** — #435 is P0 but is not "turn on the flag". Confirm private/no-store
  defaults, prove thrown errors and preference-shaped responses cannot become
  cacheable, refuse caching for nonce-CSP SSR HTML, then enable JSON/API caching
  with a real HIT/miss/purge-by-tag consumer proof. **Edge caching stays
  disabled for consumers until the negative tests pass.**

A2's exit is the gate on Wave B: no product program starts while a cross-tenant
isolation defect is open.

### Wave B — product programs and closure

| slot | lane                     | issues                                                                                                          | tier                      |
| ---- | ------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------- |
| B1   | Components suite & shell | #247 children #250–#269, #296, #386, #387, #518, #535, #601, #602                                               | Opus 5 high               |
| B2   | MapKit & SEO             | #420 → #421 → #422 → #423 (strict), then #305, #402, #411, #437, #517; #170, #375, #384, #388, #390, #459, #523 | Opus 5 high               |
| B3   | Journeys & Apple capture | #66, #118, #67, #68, #69, #70, #75, then #114–#117                                                              | Opus 5 high               |
| B4   | Long-tail closure        | see exit criteria below                                                                                         | Sonnet, Opus for judgment |

- **B1** — reconcile the formatter/state overlaps (#386, #387, #518, #601, #602)
  _before_ opening implementation PRs. Open question for Logan: #247's charter
  says "22 items, one PR each, in order", while the carpool rule (2026-09-18)
  batches small independent changes. Recommendation: honor one-PR-each for the
  numbered suite items, batch the reconcile work.
- **B2** — the MapKit chain is strictly ordered; consumer adoption and release
  proof only after the candidate tarballs pass.
- **B3** — this is a **cross-repo dependency, not a self-contained lane**: every
  step is proven against pacc-trac, which has its own CI and release cadence. It
  carries a named consumer gate and a pacc-trac contact point, and its success
  measure is bespoke journey code _deleted_ from the consumer.
- **B4** — the original plan's Lane 8 was a junk drawer of ~30 issues with no
  exit criteria. Re-scoped: this lane only executes terminal-state transitions
  that Phase 1 left as `active` but out of program scope — cross-repo proof,
  external handoffs, and documented deferrals with named replacement trackers.
  It may not create a new shared package without a verified consumer, and it is
  finished when no milestone issue lacks a terminal state.

Fleet adoption (#55, #57, #76) resumes only after A1 and A3 close the
foundation-check false positives, starting from the smallest proven consumer and
meeting the issues' own proof bar: package released, consumer adopted, local
fork deleted, CI green.

## Landing and release protocol

Unchanged from the repository's existing runbook, which the original plan was
right to keep:

1. Lane runs local preflight before pushing.
2. One coherent PR per logical batch, not a stream of fixups.
3. `scripts/verify-pr-gate.py <pr>` prints the verdict; that verdict is the
   green claim. Merge behind it per the estate default (company-hq D-ORG-1 (g)).
4. Approve any `action_required` run on sight.
5. One release PR per wave; publication keeps the exact-SHA `verify` proof.
6. `npm.nard.uk` trails publication until its sync run — a consumer adoption
   step proves the mirrored version, it does not assume it.
7. Close the canonical issue and its duplicates immediately after release or
   consumer proof.

## Definition of done

The `backlog-clearout` milestone reaches zero, with every one of its 190 issues
in a terminal state and every `deferred` one carrying a named replacement
tracker. P0/P1 correctness, security, release, scaffold and adoption work has
shipped. The Components, MapKit and Journeys programs have shipped or been
explicitly transferred to their consumer repository. The final all-package
consumer proof and the release publication proof are green.

Raw open-issue count is deliberately **not** a success measure.

## Open questions

- #247: one PR per suite item, or batched? (recommendation above)
- Which lane owns the campaign milestone's label hygiene — 48 issues do not
  follow the repo's one-type/one-priority/one-area rule.
