import { and, eq, isNull, sql } from 'drizzle-orm'

import {
  devicesAuditEvents,
  devicesCredentials,
  devicesDevices,
  devicesSessions,
} from '../database/devices-schema'

import { runDevicesBatch } from './devices-atomic'

import type { Device } from '../../shared/types/devices'
import type { DevicesDatabase } from './devices'
import type { PreparedCredential } from './devices-complete-claim'
import type { SQL } from 'drizzle-orm'

/**
 * A static audit detail as `json_object` needs it: rendered by
 * `JSON.stringify` and read back by SQLite's `json()`, so the stored
 * `details_json` is byte-for-byte what `JSON.stringify` of the whole details
 * object writes, on D1 and better-sqlite3 alike. Binding the raw value does
 * not survive the trip — both drivers bind a JavaScript number as REAL, and
 * `json_object` renders it `2.0`.
 */
function jsonValue(value: string | number | null): SQL {
  return sql`json(${JSON.stringify(value)})`
}

const text = (value: string, alias: string) => sql<string>`${value}`.as(alias)
const nullable = (value: string | null, alias: string) => sql<string | null>`${value}`.as(alias)
const numeric = (value: number | null, alias: string) => sql<number>`${value}`.as(alias)

/** The device row, still claimed: the one condition every gated statement shares. */
function stillClaimed(device: Device): SQL | undefined {
  return and(eq(devicesDevices.id, device.id), eq(devicesDevices.status, 'claimed'))
}

export interface RevokeDeviceBatchInput {
  actorUserId: string | null
  /** The device as the caller read it, claimed. */
  device: Device
  reason: string | null
  revokedAt: number
}

/**
 * Revoke a device, every live credential and every live session, and write
 * the `device.revoke` audit row, in one transaction (narduk-libs#231).
 *
 * The statements used to run one at a time, so a failure after the first left
 * the device `revoked` while `getCredentialBySecret` — which reads the
 * credential row, not the device — still resolved its credentials: a
 * permanent bearer, since completion-issued credentials never expire.
 * `runDevicesBatch` is one D1 batch or one better-sqlite3 transaction and
 * refuses any adapter that could only run them sequentially, so now either
 * every statement lands or none does.
 *
 * The device write and the audit row are conditional on the device still
 * being claimed, so a caller that lost a race to a concurrent revocation
 * writes nothing: no second generation bump, no second revocation time, no
 * second audit row. The credential and session revocations are deliberately
 * unconditional. Revoking a live credential or session of this device is
 * correct whatever state the device is in, so a gate there would protect
 * nothing, and no test could tell it was missing.
 *
 * The audit row is written first so that its counts are read before the
 * statements that change them. Inside one transaction nothing can interleave,
 * so `revokedSessions` is exactly the number of sessions the next statement
 * revokes, and `revocationGeneration` exactly the one the device write sets.
 *
 * Returns the device row as this call revoked it, or null when the device was
 * no longer claimed by the time the batch ran.
 */
export async function revokeDeviceAtomically(
  db: DevicesDatabase,
  input: RevokeDeviceBatchInput,
  nextId: () => string,
): Promise<Device | null> {
  const { device, revokedAt } = input

  const audit = db
    .insert(devicesAuditEvents)
    .select(
      db
        .select({
          id: text(nextId(), 'id'),
          orgId: nullable(device.orgId, 'org_id'),
          actorUserId: nullable(input.actorUserId, 'actor_user_id'),
          action: text('device.revoke', 'action'),
          subjectKind: text('device', 'subject_kind'),
          subjectId: devicesDevices.id,
          detailsJson: sql<string>`json_object(
            'reason', ${jsonValue(input.reason)},
            'revocationGeneration', ${devicesDevices.revocationGeneration} + 1,
            'revokedSessions', (SELECT COUNT(*) FROM devices_sessions WHERE device_id = ${device.id} AND revoked_at IS NULL)
          )`.as('details_json'),
          createdAt: numeric(revokedAt, 'created_at'),
        })
        .from(devicesDevices)
        .where(stillClaimed(device)),
    )
    .returning({ id: devicesAuditEvents.id })

  const sessions = db
    .update(devicesSessions)
    .set({ revokedAt })
    .where(and(eq(devicesSessions.deviceId, device.id), isNull(devicesSessions.revokedAt)))
    .returning({ id: devicesSessions.id })

  const credentials = db
    .update(devicesCredentials)
    .set({ revokedAt })
    .where(and(eq(devicesCredentials.deviceId, device.id), isNull(devicesCredentials.revokedAt)))
    .returning({ id: devicesCredentials.id })

  const revoke = db
    .update(devicesDevices)
    .set({
      status: 'revoked',
      revokedAt,
      revocationGeneration: sql`${devicesDevices.revocationGeneration} + 1`,
    })
    .where(stillClaimed(device))
    .returning()

  const [, , , revoked] = await runDevicesBatch(db, [audit, sessions, credentials, revoke])
  return revoked.at(0) ?? null
}

export interface RotateCredentialBatchInput {
  actorUserId: string | null
  /** The replacement, prepared by the caller so its secret never reaches SQL. */
  credential: PreparedCredential
  /** The device as the caller read it, claimed. */
  device: Device
  reason: string | null
  rotatedAt: number
}

/**
 * Rotate one credential class in one transaction (narduk-libs#231): revoke
 * that class's live sessions and credentials, issue the replacement, bump the
 * device's revocation generation, and write the `credential.rotate` audit row.
 *
 * Statement by statement, a failure part-way could leave the old secret dead
 * with no replacement, or the replacement live with the superseded class's
 * sessions still open and the generation unbumped. Now the rotation lands
 * whole or not at all.
 *
 * The new credential, the generation bump and the audit row are conditional on
 * the device still being claimed. `getCredentialBySecret` reads the credential
 * row and not the device, so a device revoked between the caller's read and
 * this batch would otherwise gain a live bearer nothing could see; instead the
 * batch issues nothing and the caller reports `revoked`. The two revocations
 * are unconditional for the reason `revokeDeviceAtomically` gives: revoking a
 * live row of this device is right in every state.
 *
 * The audit row goes first so that its counts are read before the statements
 * that change them (see `revokeDeviceAtomically`).
 *
 * Returns true when the replacement was issued.
 */
export async function rotateCredentialAtomically(
  db: DevicesDatabase,
  input: RotateCredentialBatchInput,
  nextId: () => string,
): Promise<boolean> {
  const { credential, device, rotatedAt } = input

  const audit = db
    .insert(devicesAuditEvents)
    .select(
      db
        .select({
          id: text(nextId(), 'id'),
          orgId: nullable(device.orgId, 'org_id'),
          actorUserId: nullable(input.actorUserId, 'actor_user_id'),
          action: text('credential.rotate', 'action'),
          subjectKind: text('credential', 'subject_kind'),
          subjectId: text(credential.id, 'subject_id'),
          detailsJson: sql<string>`json_object(
            'deviceId', ${jsonValue(device.id)},
            'credentialClass', ${jsonValue(credential.credentialClass)},
            'version', ${jsonValue(credential.version)},
            'revocationGeneration', ${devicesDevices.revocationGeneration} + 1,
            'revokedSessions', (SELECT COUNT(*) FROM devices_sessions WHERE device_id = ${device.id} AND credential_class = ${credential.credentialClass} AND revoked_at IS NULL),
            'reason', ${jsonValue(input.reason)}
          )`.as('details_json'),
          createdAt: numeric(rotatedAt, 'created_at'),
        })
        .from(devicesDevices)
        .where(stillClaimed(device)),
    )
    .returning({ id: devicesAuditEvents.id })

  const sessions = db
    .update(devicesSessions)
    .set({ revokedAt: rotatedAt })
    .where(
      and(
        eq(devicesSessions.deviceId, device.id),
        eq(devicesSessions.credentialClass, credential.credentialClass),
        isNull(devicesSessions.revokedAt),
      ),
    )
    .returning({ id: devicesSessions.id })

  const superseded = db
    .update(devicesCredentials)
    .set({ revokedAt: rotatedAt })
    .where(
      and(
        eq(devicesCredentials.deviceId, device.id),
        eq(devicesCredentials.credentialClass, credential.credentialClass),
        isNull(devicesCredentials.revokedAt),
      ),
    )
    .returning({ id: devicesCredentials.id })

  const issue = db
    .insert(devicesCredentials)
    .select(
      db
        .select({
          id: text(credential.id, 'id'),
          deviceId: devicesDevices.id,
          credentialClass: text(credential.credentialClass, 'credential_class'),
          secretHash: text(credential.secretHash, 'secret_hash'),
          fingerprint: text(credential.fingerprint, 'fingerprint'),
          version: numeric(credential.version, 'version'),
          issuedAt: numeric(rotatedAt, 'issued_at'),
          expiresAt: numeric(credential.expiresAt, 'expires_at'),
          revokedAt: numeric(null, 'revoked_at'),
        })
        .from(devicesDevices)
        .where(stillClaimed(device)),
    )
    .returning({ id: devicesCredentials.id })

  const bump = db
    .update(devicesDevices)
    .set({ revocationGeneration: sql`${devicesDevices.revocationGeneration} + 1` })
    .where(stillClaimed(device))
    .returning({ id: devicesDevices.id })

  const [, , , issued] = await runDevicesBatch(db, [audit, sessions, superseded, issue, bump])
  return issued.length > 0
}
