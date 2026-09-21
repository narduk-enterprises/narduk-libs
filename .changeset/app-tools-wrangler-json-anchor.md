---
'@narduk-enterprises/narduk-app-tools': patch
---

`parseWranglerVersionsJson` (used by `promote`'s
`deployments list`/`versions list` reads) now anchors to the LAST line that
starts with `[` or `{` at column 0, instead of the first bracket anywhere in the
captured stdout. A warning printed earlier in the same `pnpm exec` chain (for
example, an `engines` mismatch:
`WARN Unsupported engine: wanted: {"node":"24.21.0"}`) could contain a bracket
mid-line; the old heuristic parsed that fragment instead of wrangler's real,
later JSON document and reported a confusing "wrangler-failed" outcome that
named nothing real (#470). The parse-failure message also now includes the first
200 characters of the captured stdout, so contamination like this names itself
instead of being invisible.
