---
'@narduk-enterprises/narduk-core': minor
---

Add `registerFreshnessCheck` — a shared data-freshness health check, so an app
that serves published data can report how stale that data is instead of looking
perfectly healthy while its feed has gone quiet.

**The gap.** `/api/health` proved the app was answering and the database was
reachable. Nothing on the health contract could say "the last observation this
app publishes is nine hours old". Buoys already computes that age
(`product.freshness`, `manifest.staleness`) and publishes it as inert `detail`
on its `publication` check — "Source age describes the publication, not this
viewer's availability" — because the only two outcomes available were pass and
HTTP 503, and a stale marine feed is neither.

**The helper.**

```ts
registerFreshnessCheck({
  name: 'observations-freshness',
  source: 'ndbc-realtime-observations',
  warnAfter: 45 * 60, // seconds
  failAfter: 6 * 60 * 60, // seconds, optional
  async read({ signal }) {
    const { product } = await readPublishedProduct({ signal })
    return {
      at: product.freshness.asOf,
      detail: { releaseId: product.releaseId },
    }
  },
})
```

It publishes one `checks` entry carrying a stable `kind: 'freshness'`, plus
`detail.source`, `detail.observedAt`, `detail.ageSeconds`,
`detail.warnAfterSeconds` and `detail.failAfterSeconds`. `observedAt` and
`ageSeconds` are published while the check is passing too, so a dashboard can
plot age before anything is wrong. `at` accepts a `Date`, an ISO 8601 string or
epoch milliseconds, and `now` injects the clock for tests.

**The rollup.** Past `warnAfter` the entry fails with `required: false`, so the
report is `degraded` and `/api/health` still answers HTTP 200 — a stale feed
does not take the app down. Past `failAfter` it fails with `required: true`, so
the report is `error` and the route answers 503. A check registered without
`failAfter` can never reach that state. It **fails closed**: a missing
timestamp, an unparseable one, a `read` that throws and a `read` that times out
all fail at the strongest severity the thresholds allow, with `detail.reason`
saying which, and never pass for want of evidence. A timestamp in the future is
never stale; producer clock skew shows up as a negative `ageSeconds`.

**No new status vocabulary.** The report keeps `ok`/`degraded`/`error` and each
entry keeps `result: 'pass' | 'fail' | 'skipped'`. A check that can fail at two
severities returns `{ ok: false, severity: 'degraded' }` from `run`, which is
published as that entry's existing `required` flag, so `summarizeHealthStatus`
is unchanged and every consumer that already derives the rollup from `required`
stays correct. A check declared `required: false` can never escalate itself into
an HTTP 503.

**Compatibility.** Additive only. `kind` is omitted for every check that does
not declare one, `severity` is an input to `run` rather than a response field,
and an app that registers no freshness check gets a byte-identical `/api/health`
body. `registerHealthCheck` also accepts an optional `kind` now, validated as
1-32 lowercase letters, digits or hyphens.

**Watch the monitor.** An uptime monitor that matches the `"status":"ok"`
substring alerts on `degraded` as well as on `error`, because the substring is
simply absent. That makes `warnAfter` an alerting threshold, not just a
dashboard one; the README's "Monitoring the endpoint" section now says so.
