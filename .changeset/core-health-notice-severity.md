---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

Health checks can fail at `notice` severity: the entry publishes
`result: 'fail'` with `notice: true` and its `detail`, and the report's `status`
does not move, so a monitor matching `"status":"ok"` does not page.
`registerFreshnessCheck` takes an optional `noticeAfter` below `warnAfter` for
the aging band of a three-band freshness policy. The docs no longer describe
`degraded` as something that does not take the app down: to a `"status":"ok"`
monitor it pages like `error` (#414).
