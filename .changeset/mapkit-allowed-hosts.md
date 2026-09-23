---
'@narduk-enterprises/narduk-mapkit': minor
---

`allowedHosts` (on `MapKitServerConfig`, and the `nardukMapKit.allowedHosts`
module option) refuses a token for any routed host outside the list with
`403 not-same-origin`, before the limiter and before signing, so a forged `Host`
on a Node listener can no longer name the origin claim. Unset, nothing changes
(#437).
