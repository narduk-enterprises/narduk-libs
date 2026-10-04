---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app doctor --adoption` emits the six-check Narduk app status adopted as
D-NAC-STATUS-1 (narduk-libs#1409). The artefact gains `checks` (platform,
delivery, security, health, packages, freshness, each with `group`, `verdict`,
`measured`, `detail`, `reason`, `from`, `diagnostics`, `evidence` and `waiver`),
`status` (`narduk-app` or `not-yet`, with `blocking`), `upToDate`, `waivers`,
`dependabot` and `freshness`.

- **Additive.** `schemaVersion` stays `1` and R1-R15, `score`, `manualReview`,
  `result` and the exit codes are unchanged, because the portal's ingest refuses
  any other `schemaVersion` and reads `requirements` from the top level. The
  R1-R15 fields are deprecated and leave in the next minor, with a
  `schemaVersion` bump. R11, R13 and R14 feed no check.
- **Security reads Dependabot.** Open critical or high alerts with a patched
  release fail `security`. A token that cannot read alerts (the default Actions
  token cannot) answers `unknown` with the reason and the missing permission,
  never a pass or a fail; nothing widens a token.
- **Waivers.** `waivers: [{ check, issue, expires }]` in
  `Config/cloudflare-app.json` reports a failing or unknown check as `waived`
  through `expires` (UTC, inclusive), then as its real verdict. No sign-off.
  `delivery` and `security` cannot be waived: the entry is reported `refused`.
- `doctor --adoption` prints the status line and the six checks above the legacy
  requirement list.
