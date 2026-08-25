---
'@narduk-enterprises/journeys': minor
---

Add the Apple orchestrator, so one journey catalog produces web AND iOS output.

The first release shipped Apple bind-and-verify primitives and declaration types
only, and the first real consumer run hit that boundary immediately: the iOS
videos everybody wanted came out of a bespoke second pipeline with none of the
package's verify/promote/digest guarantees (narduk-libs#70).

New optional subpath `@narduk-enterprises/journeys/apple`: `runAppleJourneys`
drives a simulator through a declared journey — the world selected by launch
arguments, gestures through a pluggable headless-capable injector,
`simctl io recordVideo` with beat-aligned dwell, an app binary pinned by
required path, per-beat landing verification against the accessibility
hierarchy, and the simulator leased for the session. It emits the same
`njr-run/1` manifests into the same artefact layout, so `verify`, `promote` and
`walkthrough` work on an iOS run exactly as on a web one.

Also:

- `walkthrough` now assembles every surface, not web only, with per-surface
  capture profiles (`profileNames`, CLI `--profile-<surface>`).
- Journeys may declare `compromises` — a fidelity trade with its reason and its
  cost — which travel into the rehearsal script and the published walkthrough
  instead of being made ad hoc at capture time.
- `AppleJourney` is a union: `drive: 'xctest'` (the existing binding, still the
  default) or `drive: 'driven'`. Existing declarations are unchanged.
