---
'@narduk-enterprises/narduk-devices': minor
---

`createLockoutGate(...).record` returns every threshold an attempt crossed, not
only escalating ones (narduk-libs#238). A limiter built on the flat token/device
rule was never told which attempt locked its subject out, so it could not audit
the lockout without re-deriving the rule. `LockoutThreshold` gains
`escalates: boolean`; filter on it to keep the previous set. The library's own
`security.lockout` audit rows are unchanged: still written for escalating
crossings only.
