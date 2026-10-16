---
'@narduk-enterprises/narduk-realtime': minor
---

New `./client` export: `createLiveSocket`, a framework-free browser client for a
socket a `HibernatingDurableObject` serves. It keeps the socket alive with the
exact `ping` text the base class auto-answers (so an idle page never wakes the
object), replaces a socket that has heard nothing for 2.5 ping intervals, and
reconnects with jittered backoff from 1 s to 60 s. Frames are handed to the
caller parsed; the caller re-reads its data when the socket opens.
