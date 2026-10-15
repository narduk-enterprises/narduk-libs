---
'@narduk-enterprises/narduk-app-tools': patch
---

`narduk-app doctor --adoption --live --expect-sha` re-reads the smoke route (up to 6 times, 10 s apart) when it serves a readable but different build stamp, so an edge still on the previous release right after a promotion no longer grades R5 FAIL (#1889).
