---
'@narduk-enterprises/narduk-mapkit': minor
---

`createFlowPulseLayer` draws a train of comet streaks instead of one pulse.

- The old default (one 22 px dash every 200 px) put a single faint dash on a
  river that is only 200 px long at national zoom. The defaults are now a 30 px
  streak every 56 px at 90 px a second, so a short path carries several.
- A streak has a bright head and a tail that fades back (`tail` steps, default
  4), over an optional halo (`glowColor`, `glowScale`, `glowOpacity`) so it
  reads on a dark line and a light one.
- `setPath(stretches, branches?)` takes fainter, thinner streaks for tributaries
  (`branchOpacity`, `branchWidth`): `branches` is `[{ opacity, stretches }]`.
  Their lines are batched per brightness into a few strokes and spread over four
  start phases, so a lit basin of thousands of stretches still costs a handful
  of strokes a frame.
- Lines are kept as `Path2D`s between frames (`createPath` overrides it).
- Reduced motion still draws static chevrons, now over the halo too.
