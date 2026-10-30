---
'@narduk-enterprises/narduk-ui': minor
---

narduk-ui `./core`: `classifySignalByAge` classifies an observation against fixed minute limits (each an exclusive upper bound, optional stale ceiling, clock-skew tolerance, required `now`), for products that define Live by absolute age rather than the publishing interval. `worstSignal` returns the overall state across several sensors. Replaces the freshness ladders lakestat-us, buoys, borderwaitstat-us, gonogo and riverstatus each carry.
