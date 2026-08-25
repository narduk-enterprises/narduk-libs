# @narduk-enterprises/journeys

## 0.3.0

### Minor Changes

- d15c1bb: Add the Apple orchestrator, so one journey catalog produces web AND
  iOS output.

  The first release shipped Apple bind-and-verify primitives and declaration
  types only, and the first real consumer run hit that boundary immediately: the
  iOS videos everybody wanted came out of a bespoke second pipeline with none of
  the package's verify/promote/digest guarantees (narduk-libs#70).

  New optional subpath `@narduk-enterprises/journeys/apple`: `runAppleJourneys`
  drives a simulator through a declared journey — the world selected by launch
  arguments, gestures through a pluggable headless-capable injector,
  `simctl io recordVideo` with beat-aligned dwell, an app binary pinned by
  required path, per-beat landing verification against the accessibility
  hierarchy, and the simulator leased for the session. It emits the same
  `njr-run/1` manifests into the same artefact layout, so `verify`, `promote`
  and `walkthrough` work on an iOS run exactly as on a web one.

  Also:

  - `walkthrough` now assembles every surface, not web only, with per-surface
    capture profiles (`profileNames`, CLI `--profile-<surface>`).
  - Journeys may declare `compromises` — a fidelity trade with its reason and
    its cost — which travel into the rehearsal script and the published
    walkthrough instead of being made ad hoc at capture time.
  - `AppleJourney` is a union: `drive: 'xctest'` (the existing binding, still
    the default) or `drive: 'driven'`. Existing declarations are unchanged.

### Patch Changes

- ab2e782: Apple: a beat's landing must also prove the screen moved.

  Found by the adapter's first live run against a real simulator. A landing
  predicate that was already satisfied BEFORE the gesture passed instantly,
  which proves nothing about the gesture: a scroll beat whose text reads the
  same at the top and the bottom of the board passed the moment it was asked,
  and the beat after it then pressed a coordinate the scroll had not reached
  yet. Nothing was red — the exact wrong-but-green shape per-beat verification
  exists to kill.

  Every beat now also requires the accessibility hierarchy to differ from what
  it was before its gesture. The comparison is a sorted token multiset rather
  than raw text, because `idb ui describe-all` serialises its JSON keys in a
  different order on every call while a scroll genuinely changes the frame
  numbers — so this detects real movement without knowing anything about the
  injector's schema.

  `lands.unchanged: true` declares the rare beat for which standing still is the
  expected outcome. A `wait` gesture is exempt by construction.

  A beat also waits for the screen to STOP moving — two consecutive reads that
  agree — before it passes. A decelerating scroll reads "right" long before it
  settles, and the next beat's coordinate is pressed against wherever it ends
  up. This is pacing for correctness and is identical in both modes; narrative
  dwell remains the separate, capture-only thing that happens after a beat has
  passed.

  The walkthrough can also assemble a story whose halves ran in different
  places: `environments` (CLI `--env-<surface>`) beside the existing per-surface
  profiles, because a web journey runs against a deployment and a handset
  journey against an in-app fixture world. The mixed-application-revision guard
  is now per surface for the same reason — a web app and a phone app are two
  applications with two version schemes, and demanding the override on every
  cross-surface page would turn the guard into noise.

## 0.2.0

### Minor Changes

- 3cc42ec: Initial release of the journey runner: the declaration contract
  (scenarios, journeys, steps, audiences, stories, sequences, profiles) with
  load-time validation, the run-manifest schema and declaration-derived
  verification and promotion, the Playwright web adapter with test and capture
  modes, the Apple step-marker bind-and-verify primitives, the watermarked
  rehearsal builder, the promoted-runs walkthrough builder, and the `journeys`
  CLI. Implements the spec in agent-infrastructure
  `skills/visual-qa/references/journey-runner-spec.md`
  (agent-infrastructure#851).
