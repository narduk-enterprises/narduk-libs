---
'@narduk-enterprises/narduk-devices': patch
---

`openSession` re-reads the device and credential after inserting the session row and refuses (revoking that row) when a `revokeDevice` or same-class `rotateCredential` committed while it was verifying the signature, so no getter (`getSession`, `getSessionByToken`, `getSessionByTokenWithDevice`, `requireDeviceSession`) ever sees such a session as live. Sessions of the other credential class are untouched by a rotation, as before.
