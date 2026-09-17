---
'@narduk-enterprises/narduk-core': patch
---

Fix `isPrivateIPv6` so IPv4-mapped, IPv4-compatible, and NAT64 addresses decode
their embedded IPv4 instead of string-matching `::ffff:`.

This closes the loopback and unspecified bypass (`::127.0.0.1` / `::7f00:1`,
`::`, `64:ff9b::127.0.0.1`) and also **fixes a false-positive** that blocked
legitimate IPv4-mapped public hosts such as `::ffff:93.184.216.34`
(`::ffff:5db8:d822`). Consumers that previously saw those public mapped
addresses rejected as private will now see them allowed.
