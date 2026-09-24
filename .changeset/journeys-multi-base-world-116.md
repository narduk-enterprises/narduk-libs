---
'@narduk-enterprises/journeys': patch
---

`registerJourneys` accepts `base` and `world` as today's scalars or as
functions of `workerIndex`, resolves them inside the registered `test()` body,
and records the resolved origin on the run manifest. A Playwright worker pool
(`workers > 1`) is refused unless both are functions — a shared origin or
shared database across the pool is the wrong-but-green overwrite
(narduk-libs#116).
