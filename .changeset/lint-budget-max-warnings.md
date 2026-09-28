---
'@narduk-enterprises/eslint-config': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-lint` reads an optional total ceiling from `lint-budget.json`: `"maxWarnings": <non-negative integer>`. When the total warning count is above it, the run fails (exit 1) locally and in CI alike, whatever the per-rule entries allow, and the output names the total, the ceiling and each rule's count. No run records entries that would put the recorded total past the ceiling: `--accept-new-rules` (and a non-strict file's automatic recording) fails and names what it refused, while lowering and clearing entries still happen. A value that is not a non-negative integer is a configuration error (exit 2). Local rewrites keep the field.

Without the field nothing changes, so no consumer turns red on upgrade. `--max-warnings` stays refused; its message now points at the budget field. `{"strict": true, "maxWarnings": 10, "rules": {}}` is the estate default: zero warnings normally, at most 10 recorded on purpose in a pinch, adopted by each app in its next change. The generator release picks up the new package pin.
