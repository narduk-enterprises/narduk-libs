---
'@narduk-enterprises/narduk-mapkit': minor
---

`createFlowPulseLayer` can run calm, with tributaries that read as water flowing in.

- Pieces are joined whichever way the tiles draw them: a stretch drawn against the flow is turned round (and a one-piece line whose start meets the next piece is too), so a river is one long line instead of dozens, and repeated points are dropped. Before, every stretch drawn upstream broke the line and its streak restarted.
- `FlowPulseBranch.lineSizes` says how many stretches each tributary line holds. Pieces are stitched within a line only, so a streak travels a tributary unbroken and two lines that meet are never run together.
- Tributary lines shorter than `branchMinLength` (default 30 px) carry no streak, and only the 160 longest are animated. Each remaining line carries one streak, or two when it is long, on its own end-anchored period (`branchPeriod`, default 190 px), so the streaks on every line reach its end together. This replaces the four start phases. `stats.branchDropped` counts the lines left without.
- New style options: `tailOpacity` (equal-brightness tail steps that stack into a soft fade), `branchSpeed`, `branchDash`, `branchTail`, `branchPeriod`, `branchMinLength`. The defaults for the main streaks are unchanged.
