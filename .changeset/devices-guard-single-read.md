---
'@narduk-enterprises/narduk-devices': minor
---

Resolve a device session and its tenant in one query.

`DeviceSession` carries the session's own facts but not the tenant's: `orgId`,
`resourceKind`/`resourceId` and `installationId` live on the device row. A
consumer answering "which tenant is this request for?" had to resolve the bearer
and then re-read the device — two D1 round trips on the hottest authenticated
path the package has.

`getSessionByTokenWithDevice(sessionToken)` is the joined resolution, and
`requireDeviceSession` now uses it and returns `DeviceSessionWithDevice`, so
`session.device` is already populated. Proven on the real D1 driver: one
statement for the guard end to end, exactly two for the shape it replaces, and
`n` statements for `n` requests rather than `2n`.

The session's own fields are unchanged, and the device is nested rather than
merged because both rows carry `id`, `createdAt`, `revokedAt` and
`revocationGeneration`.

Adjust if you supply your own resolver: `DeviceSessionResolver` is now
`Pick<DevicesService, 'getSessionByTokenWithDevice'>`. Passing the real service
needs no change; a hand-rolled stub that only implements `getSessionByToken`
must implement the joined method instead. `getSessionByToken` itself is
unchanged and still exported.
