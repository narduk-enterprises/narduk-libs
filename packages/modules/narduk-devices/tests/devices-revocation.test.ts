import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { devicesDevices } from '../server/database/devices-schema'
import { createDevices, type DevicesDatabase } from '../server/utils/devices'

import {
  claimDevice,
  createTestHarness,
  createTestIdGenerator,
  ORG,
  signedOpen,
} from './support/database'
import { codeOf } from './support/expect'

type Harness = ReturnType<typeof createTestHarness>

/** Every row a revocation or a rotation can write, read straight from SQLite. */
function stateOf(harness: Harness) {
  const rows = (query: string) => harness.sqlite.prepare(query).all()
  return {
    devices: rows(
      'SELECT id, status, revoked_at, revocation_generation FROM devices_devices ORDER BY id',
    ),
    credentials: rows(
      'SELECT id, credential_class, version, revoked_at FROM devices_credentials ORDER BY id',
    ),
    sessions: rows('SELECT id, credential_class, revoked_at FROM devices_sessions ORDER BY id'),
    audit: rows(
      'SELECT id, action, subject_id, details_json FROM devices_audit_events ORDER BY id',
    ),
  }
}

/** A claimed device holding a live session of each credential class. */
async function deviceWithSessions(harness: Harness) {
  const claimed = await claimDevice(harness)
  const command = await harness.devices.openSession(
    (await signedOpen(harness, claimed, 'command')).input,
  )
  const ingest = await harness.devices.openSession(
    (await signedOpen(harness, claimed, 'ingest')).input,
  )
  return { claimed, command, ingest }
}

/** The bearer check the edge actually runs: a bare secret, resolved or not. */
function resolves(harness: Harness, secret: string) {
  return harness.devices.getCredentialBySecret(secret, { unattributed: true })
}

function auditRows(harness: Harness, action: string) {
  return harness.sqlite
    .prepare(
      'SELECT org_id, actor_user_id, subject_kind, subject_id, details_json, created_at FROM devices_audit_events WHERE action = ? ORDER BY id',
    )
    .all(action)
}

/** Make the next write matching `when` fail inside SQLite, the way a D1 statement can. */
function induceFault(harness: Harness, when: string) {
  harness.sqlite.exec(
    `CREATE TRIGGER induced_fault ${when} BEGIN SELECT RAISE(ABORT, 'induced fault'); END`,
  )
  return () => harness.sqlite.exec('DROP TRIGGER induced_fault')
}

/**
 * A database whose first read of `devices_devices` is `staleDevice` — the row
 * as a caller saw it before a concurrent revocation committed. Every write,
 * and every later read, is the real database, so the batch alone decides.
 */
function withStaleDeviceRead(db: DevicesDatabase, staleDevice: unknown): DevicesDatabase {
  let served = false
  const chain = (rows: unknown[]) => {
    const self: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'orderBy', 'limit']) self[method] = () => self
    self.all = () => rows
    self.get = () => rows.at(0)
    return self
  }
  // One documented cast, as in the concurrency suite: the wrapper answers only
  // the select chain the service calls, which is all a stale read needs.
  const wrapper = Object.create(db) as Record<string, unknown>
  wrapper.select = (fields?: unknown) => {
    const builder = fields === undefined ? db.select() : db.select(fields as never)
    return {
      from(table: unknown) {
        if (table === devicesDevices && !served) {
          served = true
          return chain([staleDevice])
        }
        return builder.from(table as never)
      },
    }
  }
  return wrapper as DevicesDatabase
}

async function deviceRow(harness: Harness, deviceId: string) {
  return (
    await harness.db.select().from(devicesDevices).where(eq(devicesDevices.id, deviceId)).all()
  ).at(0)
}

/**
 * narduk-libs#231: `revokeDevice` and `rotateCredential` wrote their
 * statements one at a time, so a failure part-way left a revoked device whose
 * credentials still resolved — a permanent bearer, since completion-issued
 * credentials never expire — or a rotation that had killed the old secret but
 * left that class's sessions open. Both now run as one `runDevicesBatch`.
 */
describe('revokeDevice and rotateCredential are all-or-nothing', () => {
  it('writes exactly the rows, audit details included, the statement-by-statement version wrote', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const { claimed, command, ingest } = await deviceWithSessions(harness)
    const secondCommand = await devices.openSession(
      (await signedOpen(harness, claimed, 'command')).input,
    )

    clock.advance(1000)
    const rotatedAt = clock.now()
    // A reason that exercises every escaping rule JSON has.
    const reason = 'scheduled "rotation" \\ path/Ω\n\t\u0001 \uD800'
    const rotated = await devices.rotateCredential({
      deviceId: claimed.deviceId,
      credentialClass: 'command',
      actorUserId: 'owner-1',
      reason,
    })
    expect(rotated).toMatchObject({ credentialClass: 'command', version: 2 })
    expect(auditRows(harness, 'credential.rotate')).toEqual([
      {
        org_id: ORG,
        actor_user_id: 'owner-1',
        subject_kind: 'credential',
        subject_id: rotated.credentialId,
        details_json: JSON.stringify({
          deviceId: claimed.deviceId,
          credentialClass: 'command',
          version: 2,
          revocationGeneration: 1,
          revokedSessions: 2,
          reason,
        }),
        created_at: rotatedAt,
      },
    ])
    expect(await devices.getSession(command.sessionId)).toBeNull()
    expect(await devices.getSession(secondCommand.sessionId)).toBeNull()
    expect(await devices.getSession(ingest.sessionId)).not.toBeNull()

    clock.advance(1000)
    const revokedAt = clock.now()
    const before = await devices.getDevice(claimed.deviceId)
    expect(before).toMatchObject({ status: 'claimed', revocationGeneration: 1 })
    const revoked = await devices.revokeDevice({ deviceId: claimed.deviceId })
    expect(revoked).toEqual({ ...before, status: 'revoked', revokedAt, revocationGeneration: 2 })
    expect(await devices.getDevice(claimed.deviceId)).toEqual(revoked)
    expect(auditRows(harness, 'device.revoke')).toEqual([
      {
        org_id: ORG,
        actor_user_id: null,
        subject_kind: 'device',
        subject_id: claimed.deviceId,
        details_json: JSON.stringify({
          reason: null,
          revocationGeneration: 2,
          revokedSessions: 1,
        }),
        created_at: revokedAt,
      },
    ])

    // Rows already revoked keep the time they were revoked at.
    expect(stateOf(harness).credentials).toEqual(
      [
        {
          id: claimed.ingest.credentialId,
          credential_class: 'ingest',
          version: 1,
          revoked_at: revokedAt,
        },
        {
          id: claimed.command.credentialId,
          credential_class: 'command',
          version: 1,
          revoked_at: rotatedAt,
        },
        {
          id: rotated.credentialId,
          credential_class: 'command',
          version: 2,
          revoked_at: revokedAt,
        },
      ].sort((left, right) => (left.id < right.id ? -1 : 1)),
    )
    for (const secret of [claimed.ingest.secret, claimed.command.secret, rotated.secret]) {
      expect(await resolves(harness, secret)).toBeNull()
    }
    expect(await devices.getSession(ingest.sessionId)).toBeNull()
  })

  it.each([
    ['the device row', 'BEFORE UPDATE ON devices_devices'],
    ['a credential', 'BEFORE UPDATE ON devices_credentials'],
    ['a session', 'BEFORE UPDATE ON devices_sessions'],
    ['the audit row', 'BEFORE INSERT ON devices_audit_events'],
  ])('leaves no half-revoked device when writing %s fails', async (_, when) => {
    const harness = createTestHarness()
    const { devices } = harness
    const { claimed, command, ingest } = await deviceWithSessions(harness)
    const before = stateOf(harness)

    const clear = induceFault(harness, when)
    await expect(
      devices.revokeDevice({ deviceId: claimed.deviceId, actorUserId: 'owner-1' }),
    ).rejects.toThrow(/induced fault/u)
    // Not one row moved: the device is still claimed, so its credentials
    // resolving is the consistent state, not the dangerous one.
    expect(stateOf(harness)).toEqual(before)
    expect(await resolves(harness, claimed.ingest.secret)).not.toBeNull()

    // Once the fault clears, the retry revokes the lot and nothing resolves.
    clear()
    await expect(
      devices.revokeDevice({ deviceId: claimed.deviceId, actorUserId: 'owner-1' }),
    ).resolves.toMatchObject({ status: 'revoked', revocationGeneration: 1 })
    for (const credential of [claimed.ingest, claimed.command]) {
      expect(await resolves(harness, credential.secret)).toBeNull()
    }
    expect(await devices.getSession(command.sessionId)).toBeNull()
    expect(await devices.getSession(ingest.sessionId)).toBeNull()
    expect(auditRows(harness, 'device.revoke')).toHaveLength(1)
  })

  it.each([
    ['revoking the superseded credential', 'BEFORE UPDATE ON devices_credentials'],
    ['inserting the new credential', 'BEFORE INSERT ON devices_credentials'],
    ['bumping the generation', 'BEFORE UPDATE ON devices_devices'],
    ["ending the class's sessions", 'BEFORE UPDATE ON devices_sessions'],
    ['the audit row', 'BEFORE INSERT ON devices_audit_events'],
  ])('leaves no half-rotated credential when %s fails', async (_, when) => {
    const harness = createTestHarness()
    const { devices } = harness
    const { claimed, command, ingest } = await deviceWithSessions(harness)
    const before = stateOf(harness)

    const clear = induceFault(harness, when)
    await expect(
      devices.rotateCredential({ deviceId: claimed.deviceId, credentialClass: 'command' }),
    ).rejects.toThrow(/induced fault/u)
    // Nothing rotated: the old secret and its session still work, and no new
    // credential exists for anyone to hold.
    expect(stateOf(harness)).toEqual(before)
    expect(await resolves(harness, claimed.command.secret)).not.toBeNull()
    expect(await devices.getSession(command.sessionId)).not.toBeNull()

    clear()
    const rotated = await devices.rotateCredential({
      deviceId: claimed.deviceId,
      credentialClass: 'command',
    })
    expect(rotated.version).toBe(2)
    expect(await resolves(harness, claimed.command.secret)).toBeNull()
    expect(await resolves(harness, rotated.secret)).toMatchObject({
      id: rotated.credentialId,
      version: 2,
    })
    expect((await devices.getDevice(claimed.deviceId))?.revocationGeneration).toBe(1)
    expect(await devices.getSession(command.sessionId)).toBeNull()
    expect(await devices.getSession(ingest.sessionId)).not.toBeNull()
    expect(auditRows(harness, 'credential.rotate')).toHaveLength(1)
  })

  it('never issues a credential to a device revoked after the rotation read it', async () => {
    const harness = createTestHarness()
    const { claimed } = await deviceWithSessions(harness)
    const stale = await deviceRow(harness, claimed.deviceId)
    expect(stale).toMatchObject({ status: 'claimed' })

    // The revocation commits between the rotation's read and its write.
    harness.clock.advance(1000)
    await harness.devices.revokeDevice({ deviceId: claimed.deviceId, actorUserId: 'owner-1' })
    const revoked = stateOf(harness)

    const racing = createDevices(withStaleDeviceRead(harness.db, stale), {
      now: harness.clock.now,
      idGenerator: createTestIdGenerator('race'),
      secretGenerator: () => 'raced-secret',
    })
    expect(
      await codeOf(
        racing.rotateCredential({ deviceId: claimed.deviceId, credentialClass: 'command' }),
      ),
    ).toBe('revoked')
    // The revoked device gained no live bearer, and nothing else moved either.
    expect(await resolves(harness, 'raced-secret')).toBeNull()
    expect(stateOf(harness)).toEqual(revoked)
  })

  it('lets a revocation that lost the race write nothing and report the stored device', async () => {
    const harness = createTestHarness()
    const { claimed } = await deviceWithSessions(harness)
    const stale = await deviceRow(harness, claimed.deviceId)

    harness.clock.advance(1000)
    const winner = await harness.devices.revokeDevice({
      deviceId: claimed.deviceId,
      actorUserId: 'owner-1',
    })
    const settled = stateOf(harness)

    harness.clock.advance(1000)
    const racing = createDevices(withStaleDeviceRead(harness.db, stale), {
      now: harness.clock.now,
      idGenerator: createTestIdGenerator('race'),
    })
    // No second bump, no second revocation time, no second audit row.
    await expect(
      racing.revokeDevice({ deviceId: claimed.deviceId, actorUserId: 'owner-2' }),
    ).resolves.toEqual(winner)
    expect(stateOf(harness)).toEqual(settled)
  })

  it('refuses to revoke or rotate on a database without a transaction capability', async () => {
    const harness = createTestHarness()
    const { claimed } = await deviceWithSessions(harness)
    const before = stateOf(harness)
    const plain = createDevices(
      {
        select: harness.db.select.bind(harness.db),
        insert: harness.db.insert.bind(harness.db),
        update: harness.db.update.bind(harness.db),
        delete: harness.db.delete.bind(harness.db),
      },
      { now: harness.clock.now },
    )
    expect(await codeOf(plain.revokeDevice({ deviceId: claimed.deviceId }))).toBe('invalid')
    expect(
      await codeOf(
        plain.rotateCredential({ deviceId: claimed.deviceId, credentialClass: 'ingest' }),
      ),
    ).toBe('invalid')
    // Refused before touching anything: a sequential fallback is the bug.
    expect(stateOf(harness)).toEqual(before)
  })
})
