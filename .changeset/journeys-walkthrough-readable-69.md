---
'@narduk-enterprises/journeys': patch
---

`buildWalkthrough` writes a complete, dark-mode-aware HTML page, copies
promoted shots and video into `--dest`, and emits `walkthrough.md` beside
it so GitHub can render the narrative. `journeys promote --all` promotes
the newest passed capture per journey (narduk-libs#69).
