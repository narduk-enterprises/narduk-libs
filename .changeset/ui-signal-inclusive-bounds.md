---
'@narduk-enterprises/narduk-ui': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-ui adds `inclusive: true` to the limits `classifySignalByAge` takes, which makes each limit an inclusive upper bound: Live through exactly `live` minutes, Aging through exactly `aging`, and "void" only after `stale`. It is for a rule that reads "60 minutes or less". The default stays exclusive bounds, and the future tolerance is unchanged. Apps that offset each limit by a millisecond to get inclusive bounds (gonogo) can drop that.
