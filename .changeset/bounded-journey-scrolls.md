---
'@narduk-enterprises/journeys': patch
---

journeys: bound every scroll the web helpers await.

Playwright's default action timeout is zero, so `scrollIntoViewIfNeeded()`
called with no options never gives up. `point()` parked two hosted capture
builds at 17 minutes each (narduk-libs#77), and `must()` carried the identical
unbounded call — in both modes, so it could wedge the regression gate and not
only the camera. Both are bounded at 4s now, and both already swallowed their
own failures, so the bound degrades to "no highlight drawn" and "click without a
pre-scroll".
