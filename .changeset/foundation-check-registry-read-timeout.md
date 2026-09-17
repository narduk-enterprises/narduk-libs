---
'@narduk-enterprises/narduk-app-tools': patch
---

`foundation:check` sub-check 2.3 (narduk-core N-1 window) now raises the
default registry-read timeout from 4000 ms to 20000 ms, overridable via
`NARDUK_FOUNDATION_REGISTRY_TIMEOUT_MS`, and retries up to twice with
backoff on timeout/network-error/5xx responses only -- never on
401/403/404. This fixes false-`unknown` (blocking) results on the on-prem
runner's slow GitHub path (narduk-libs#341). Fail-closed semantics are
unchanged: a genuinely unreachable registry still reports `unknown` after
exhausting the retry budget.
