import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { devicesClaimSessions, devicesClaimTokens } from '../server/database/devices-schema'
import { createDevices, type DevicesDatabase, type DevicesService } from '../server/utils/devices'

import {
  ALGORITHM,
  claimDevice,
  completionRequest,
  createDeviceKey,
  createTestHarness,
  createTestIdGenerator,
  FINGERPRINT,
  ORG,
  signedOpen,
  startPendingClaim,
  type TestHarness,
  VESSEL,
} from './support/database'
import { codeOf } from './support/expect'
import { DEVICE_CREATE_WRITE, interleaveAtWrite } from './support/interleave'

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

/**
 * Two first-time completions of one claim, genuinely contending.
 *
 * The losing caller runs against a database that holds its device-creating
 * write open until the winner -- the harness's own service on the same SQLite
 * file, as a second process would be -- has finished. Both therefore read a
 * claim session that is still `pending_user_approval` and contend for the one
 * completion it has. `Promise.all` produced that only when the scheduler
 * happened to interleave the two calls; when they serialised, the second was
 * an ordinary replay and answered without the winner's `deviceId`
 * (narduk-libs#445).
 */
async function contendedCompletion<T>(
  harness: TestHarness,
  call: (service: DevicesService, idempotencyKey: string) => Promise<T>,
  keys: { loser: string; winner: string },
): Promise<{ loser: T; winner: T }> {
  let winner: T | undefined
  const contended = createDevices(
    interleaveAtWrite(harness.db, {
      whenWriting: DEVICE_CREATE_WRITE,
      sneak: async () => {
        winner = await call(harness.devices, keys.winner)
      },
    }),
    { now: harness.clock.now, idGenerator: createTestIdGenerator('race') },
  )
  const loser = await call(contended, keys.loser)
  if (winner === undefined) throw new Error('the gated write never ran, so nothing contended')
  return { loser, winner }
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
    const complete = (service: DevicesService, idempotencyKey: string) =>
      service.completeClaim({
        claimSessionId: pending.claimSessionId,
        orgId: ORG,
        resource: VESSEL,
        installationId: 'inst-1',
        hardwareFingerprint: FINGERPRINT,
        userApprovalToken: approval.token,
        approvedByUserId: 'owner-1',
        idempotencyKey,
      })

    const { loser, winner } = await contendedCompletion(harness, complete, {
      loser: 'b',
      winner: 'a',
    })
    // Which caller wins is now decided, not observed, so each is named.
    expect(winner.status).toBe('completed')
    expect(loser.status).toBe('already_completed')
    expect(loser.deviceId).toBe(winner.deviceId)
    expect(loser.credentials).toEqual([])

    const devicesRows = harness.sqlite.prepare('SELECT id FROM devices_devices').all()
    expect(devicesRows).toHaveLength(1)
    const credentials = harness.sqlite.prepare('SELECT id FROM devices_credentials').all()
    expect(credentials).toHaveLength(2)
    const tokens = harness.sqlite
      .prepare('SELECT consumed_at FROM devices_claim_tokens')
      .all() as Array<{ consumed_at: number | null }>
    expect(tokens[0]?.consumed_at).not.toBeNull()
  })

  /**
   * narduk-libs#228 third review LOW-4. The race-loser branch used to pass a
   * bare `true` for `discloseDeviceId`, justified as "a caller that ran the
   * full authorization". On `completeClaimWithRecordedApproval` that rationale
   * does not hold: `authorize` verifies a proof only `if (proof !== undefined)`,
   * so a *first* completion with no proof is authorized on the recorded
   * approval plus four values that all travel on the wire — authorized, but
   * having proved nothing. `deviceId` names the scope of the library's own
   * re-issue lock, which is why H3 stopped handing it to callers like that.
   */
  it('tells a proof-less race loser nothing it did not already know', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const pending = await startPendingClaim(harness)
    await devices.issueApprovalToken({
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
    })
    // No `deviceProof`, so no possession is proved. Every field below is on the
    // wire in the handoff this path models.
    const complete = (idempotencyKey: string) =>
      devices.completeClaimWithRecordedApproval({
        claimSessionId: pending.claimSessionId,
        devicePublicKey: pending.key.publicKey,
        hardwareFingerprint: FINGERPRINT,
        installationId: 'inst-1',
        idempotencyKey,
      })

    const results = await Promise.all([complete('race-a'), complete('race-b')])
    expect(results.map((result) => result.status).sort()).toEqual([
      'already_completed',
      'completed',
    ])
    const loser = results.find((result) => result.status === 'already_completed')
    // The loser really is the race loser, not a replay: a replay of a
    // completion this session already made is reached only on a later call.
    expect(loser?.credentials).toEqual([])
    expect(loser?.deviceId).toBeUndefined()
  })

  /**
   * The other half of LOW-4: disclosure is gated on *proof*, not switched off.
   * A loser that signed this exact request is a device that would have been
   * handed `deviceId` had it won, and still is.
   */
  it('still hands the race loser deviceId when it proved possession', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const pending = await startPendingClaim(harness)
    await devices.issueApprovalToken({
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
    })
    const complete = (service: DevicesService, idempotencyKey: string) => {
      const { input } = completionRequest(harness, {
        claimSessionId: pending.claimSessionId,
        idempotencyKey,
        key: pending.key,
      })
      return service.completeClaimWithRecordedApproval({
        ...input,
        reissueOnIdempotentReplay: false,
      })
    }

    const { loser, winner } = await contendedCompletion(harness, complete, {
      loser: 'proved-b',
      winner: 'proved-a',
    })
    expect(winner.status).toBe('completed')
    expect(loser.status).toBe('already_completed')
    expect(loser.credentials).toEqual([])
    expect(loser.deviceId).toBe(winner.deviceId)
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
