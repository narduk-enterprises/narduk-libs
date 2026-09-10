import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { devicesClaimSessions, devicesClaimTokens } from '../server/database/devices-schema'
import { createDevices, type DevicesDatabase } from '../server/utils/devices'

import {
  ALGORITHM,
  claimDevice,
  createDeviceKey,
  createTestHarness,
  createTestIdGenerator,
  FINGERPRINT,
  ORG,
  signedOpen,
  startPendingClaim,
  VESSEL,
} from './support/database'
import { codeOf } from './support/expect'

/**
 * A database whose early reads are stale, exactly as a read that raced another
 * transaction is: the first `blindClaimSessions` reads of
 * `devices_claim_sessions` come back empty and the first read of
 * `devices_claim_tokens` returns `staleToken` (the row as it was before the
 * winner consumed it). Every write, and every later read, is the real database,
 * so the mutation alone decides the outcome.
 */
function withStaleReads(
  db: DevicesDatabase,
  options: { blindClaimSessions: number; staleToken: unknown },
): DevicesDatabase {
  let blinded = 0
  let staleTokenServed = false
  const chain = (rows: unknown[]) => {
    const self: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'orderBy', 'limit']) self[method] = () => self
    self.all = () => rows
    self.get = () => rows.at(0)
    return self
  }
  // One documented cast: the wrapper answers only the two chain methods the
  // service calls on a select, which is all a stale-read simulation needs.
  const wrapper = Object.create(db) as Record<string, unknown>
  wrapper.select = (fields?: unknown) => {
    const builder = fields === undefined ? db.select() : db.select(fields as never)
    return {
      from(table: unknown) {
        if (table === devicesClaimSessions && blinded < options.blindClaimSessions) {
          blinded += 1
          return chain([])
        }
        if (table === devicesClaimTokens && !staleTokenServed) {
          staleTokenServed = true
          return chain([options.staleToken])
        }
        return builder.from(table as never)
      },
    }
  }
  return wrapper as DevicesDatabase
}

describe('concurrent completion', () => {
  it('lets exactly one of two concurrent completions issue credentials', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const pending = await startPendingClaim(harness)
    const approval = await devices.issueApprovalToken({
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
    })
    const complete = (idempotencyKey: string) =>
      devices.completeClaim({
        claimSessionId: pending.claimSessionId,
        orgId: ORG,
        resource: VESSEL,
        installationId: 'inst-1',
        hardwareFingerprint: FINGERPRINT,
        userApprovalToken: approval.token,
        approvedByUserId: 'owner-1',
        idempotencyKey,
      })

    const results = await Promise.all([complete('a'), complete('b')])
    const statuses = results.map((result) => result.status).sort()
    expect(statuses).toEqual(['already_completed', 'completed'])
    const winner = results.find((result) => result.status === 'completed')
    const loser = results.find((result) => result.status === 'already_completed')
    expect(loser?.deviceId).toBe(winner?.deviceId)
    expect(loser?.credentials).toEqual([])

    const devicesRows = harness.sqlite.prepare('SELECT id FROM devices_devices').all()
    expect(devicesRows).toHaveLength(1)
    const credentials = harness.sqlite.prepare('SELECT id FROM devices_credentials').all()
    expect(credentials).toHaveLength(2)
    const tokens = harness.sqlite
      .prepare('SELECT consumed_at FROM devices_claim_tokens')
      .all() as Array<{ consumed_at: number | null }>
    expect(tokens[0]?.consumed_at).not.toBeNull()
  })

  it('lets exactly one of two concurrent starts redeem a claim token', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const key = createDeviceKey()
    const minted = await devices.createClaimToken({
      orgId: ORG,
      resource: VESSEL,
      createdByUserId: 'owner-1',
    })
    const start = (idempotencyKey: string) =>
      devices.startClaim({
        claimToken: minted.token,
        hardwareFingerprint: FINGERPRINT,
        hardwareFingerprintAlgorithm: ALGORITHM,
        devicePublicKey: key.publicKey,
        softwareVersion: '1.0.0',
        idempotencyKey,
      })

    // The tenancy concurrency pattern: both calls in flight, one mutation.
    const results = await Promise.all([start('a'), start('b')])
    expect(results.map((result) => result.status)).toEqual([
      'pending_user_approval',
      'pending_user_approval',
    ])
    expect(results[0]?.claimSessionId).toBe(results[1]?.claimSessionId)

    const sessions = harness.sqlite
      .prepare('SELECT id FROM devices_claim_sessions')
      .all() as Array<{ id: string }>
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.id).toBe(results[0]?.claimSessionId)

    // Redemption consumed the token in the same transaction, and named the
    // session that consumed it.
    const tokens = harness.sqlite
      .prepare('SELECT consumed_at, consumed_by_claim_session_id FROM devices_claim_tokens')
      .all() as Array<{ consumed_at: number | null; consumed_by_claim_session_id: string | null }>
    expect(tokens[0]?.consumed_at).not.toBeNull()
    expect(tokens[0]?.consumed_by_claim_session_id).toBe(results[0]?.claimSessionId)

    // The UNIQUE index is the backstop, whatever the service does.
    expect(() =>
      harness.sqlite
        .prepare(
          'INSERT INTO devices_claim_sessions (id, claim_token_id, idempotency_key, hardware_fingerprint, fingerprint_algorithm, public_key, software_version, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'second',
          minted.tokenId,
          'idem-second',
          FINGERPRINT,
          ALGORITHM,
          key.publicKey,
          '1.0.0',
          'pending_user_approval',
          minted.expiresAt,
          1,
        ),
    ).toThrow(/UNIQUE constraint failed/u)
  })

  it('refuses to redeem a token again even when every pre-read is stale', async () => {
    const harness = createTestHarness()
    const key = createDeviceKey()
    const minted = await harness.devices.createClaimToken({
      orgId: ORG,
      resource: VESSEL,
      createdByUserId: 'owner-1',
    })
    // The token exactly as the service saw it before anyone redeemed it.
    const staleToken = (
      await harness.db
        .select()
        .from(devicesClaimTokens)
        .where(eq(devicesClaimTokens.id, minted.tokenId))
        .all()
    ).at(0)
    expect(staleToken).toMatchObject({ consumedAt: null, consumedByClaimSessionId: null })
    const pending = await harness.devices.startClaim({
      claimToken: minted.token,
      hardwareFingerprint: FINGERPRINT,
      hardwareFingerprintAlgorithm: ALGORITHM,
      devicePublicKey: key.publicKey,
      softwareVersion: '1.0.0',
      idempotencyKey: 'race-winner',
    })
    expect(pending.status).toBe('pending_user_approval')

    // One id generator across every racing caller: distinct rows, as separate
    // processes would produce.
    const raceIds = createTestIdGenerator('race')
    const start = (blindClaimSessions: number, hardwareFingerprint: string, key_: string) =>
      createDevices(withStaleReads(harness.db, { blindClaimSessions, staleToken }), {
        now: harness.clock.now,
        idGenerator: raceIds,
      }).startClaim({
        claimToken: minted.token,
        hardwareFingerprint,
        hardwareFingerprintAlgorithm: ALGORITHM,
        devicePublicKey: key.publicKey,
        softwareVersion: '1.0.0',
        idempotencyKey: key_,
      })

    // Stale token read plus blind idempotency and prior-session reads: the
    // caller reaches the mutation believing the token is unredeemed. The
    // mutation refuses, and the caller is told about the session that won.
    const lost = await start(2, FINGERPRINT, 'race-a')
    expect(lost).toMatchObject({
      claimSessionId: pending.claimSessionId,
      status: 'pending_user_approval',
    })

    // Different hardware behind the same stale reads is a mismatch, not a session.
    const other = await start(2, 'sha256:other-box', 'race-b')
    expect(other).toMatchObject({ claimSessionId: null, status: 'hardware_mismatch' })

    // One session, one consumption, throughout.
    expect(harness.sqlite.prepare('SELECT id FROM devices_claim_sessions').all()).toHaveLength(1)
    const tokens = harness.sqlite
      .prepare('SELECT consumed_by_claim_session_id FROM devices_claim_tokens')
      .all() as Array<{ consumed_by_claim_session_id: string | null }>
    expect(tokens[0]?.consumed_by_claim_session_id).toBe(pending.claimSessionId)

    // And with the session gone but the token still consumed (a pruned or
    // partially restored row), a stale read still cannot redeem it.
    harness.sqlite.prepare('DELETE FROM devices_claim_sessions').run()
    expect(await start(0, FINGERPRINT, 'race-c')).toMatchObject({
      claimSessionId: null,
      status: 'revoked',
    })
    expect(harness.sqlite.prepare('SELECT id FROM devices_claim_sessions').all()).toEqual([])
  })

  it('rolls back every statement when a credential write fails', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const pending = await startPendingClaim(harness)
    const approval = await devices.issueApprovalToken({
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
    })
    harness.sqlite.exec(
      "CREATE TRIGGER fail_credential BEFORE INSERT ON devices_credentials WHEN NEW.credential_class = 'command' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END",
    )
    const complete = () =>
      devices.completeClaim({
        claimSessionId: pending.claimSessionId,
        orgId: ORG,
        resource: VESSEL,
        installationId: 'inst-1',
        hardwareFingerprint: FINGERPRINT,
        userApprovalToken: approval.token,
        approvedByUserId: 'owner-1',
        idempotencyKey: 'c',
      })
    await expect(complete()).rejects.toThrow(/simulated failure/u)
    expect(harness.sqlite.prepare('SELECT id FROM devices_devices').all()).toHaveLength(0)
    expect(await devices.getClaimSession(pending.claimSessionId)).toMatchObject({
      status: 'pending_user_approval',
      deviceId: null,
    })
    harness.sqlite.exec('DROP TRIGGER fail_credential')
    expect((await complete()).status).toBe('completed')
  })

  it('admits exactly one of two identical concurrent session opens', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const claimed = await claimDevice(harness)
    const { input } = await signedOpen(harness, claimed, 'command')
    const results = await Promise.allSettled([
      devices.openSession(input),
      devices.openSession(input),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })

  it('still counts a failed attempt on a database without a transaction capability', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    const plain = createDevices(
      {
        select: harness.db.select.bind(harness.db),
        insert: harness.db.insert.bind(harness.db),
        update: harness.db.update.bind(harness.db),
        delete: harness.db.delete.bind(harness.db),
      },
      { now: harness.clock.now },
    )
    const { input } = await signedOpen(harness, claimed, 'command')
    expect(await codeOf(plain.openSession({ ...input, signature: 'A'.repeat(85) }))).toBe(
      'unauthorized',
    )
    const attempts = harness.sqlite
      .prepare(
        "SELECT subject FROM devices_auth_attempts WHERE outcome = 'failure' AND subject_kind = 'device'",
      )
      .all() as Array<{ subject: string }>
    expect(attempts).toEqual([{ subject: claimed.deviceId }])
  })

  it('refuses to complete a claim on a database without a transaction capability', async () => {
    const harness = createTestHarness()
    const pending = await startPendingClaim(harness)
    const approval = await harness.devices.issueApprovalToken({
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
    })
    const wrapper = createDevices(
      {
        select: harness.db.select.bind(harness.db),
        insert: harness.db.insert.bind(harness.db),
        update: harness.db.update.bind(harness.db),
        delete: harness.db.delete.bind(harness.db),
      },
      { now: harness.clock.now },
    )
    expect(
      await codeOf(
        wrapper.completeClaim({
          claimSessionId: pending.claimSessionId,
          orgId: ORG,
          resource: VESSEL,
          installationId: 'inst-1',
          hardwareFingerprint: FINGERPRINT,
          userApprovalToken: approval.token,
          approvedByUserId: 'owner-1',
          idempotencyKey: 'c',
        }),
      ),
    ).toBe('invalid')
  })
})
