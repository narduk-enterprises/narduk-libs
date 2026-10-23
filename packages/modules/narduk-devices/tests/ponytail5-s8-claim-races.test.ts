import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { devicesClaimSessions } from '../server/database/devices-schema'
import {
  CHALLENGE_DEFAULT_TTL_SECONDS,
  createDevices,
  type DevicesDatabase,
} from '../server/utils/devices'

import {
  ALGORITHM,
  claimDevice,
  completionRequest,
  createDeviceKey,
  createTestHarness,
  createTestIdGenerator,
  FINGERPRINT,
  ORG,
  startPendingClaim,
  type TestHarness,
  VESSEL,
} from './support/database'
import { codeOf } from './support/expect'
import { interleaveAtWrite, REISSUE_LOCK_WRITE } from './support/interleave'

/**
 * Ponytail-5 s8 repros for #2003 analytics-seo-devices #3-#8: claim, rotate and
 * prune races. Each was red before its fix.
 */

function revokedAt(harness: TestHarness, credentialId: string): number | null {
  const row = harness.sqlite
    .prepare('SELECT revoked_at FROM devices_credentials WHERE id = ?')
    .get(credentialId) as { revoked_at: number | null }
  return row.revoked_at
}

async function approve(harness: TestHarness, claimSessionId: string) {
  return harness.devices.issueApprovalToken({
    claimSessionId,
    orgId: ORG,
    resource: VESSEL,
    hardwareFingerprint: FINGERPRINT,
    approvedByUserId: 'owner-1',
  })
}

describe('claim and credential races', () => {
  it('#3 leaves the completion proof unspent when the completion batch fails', async () => {
    const harness = createTestHarness()
    const pending = await startPendingClaim(harness)
    await approve(harness, pending.claimSessionId)
    const request = completionRequest(harness, {
      claimSessionId: pending.claimSessionId,
      idempotencyKey: 'complete-1',
      key: pending.key,
    }).input
    harness.sqlite.exec(
      "CREATE TRIGGER fail_credential BEFORE INSERT ON devices_credentials WHEN NEW.credential_class = 'command' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END",
    )
    await expect(harness.devices.completeClaimWithRecordedApproval(request)).rejects.toThrow(
      /simulated failure/u,
    )
    harness.sqlite.exec('DROP TRIGGER fail_credential')
    expect((await harness.devices.completeClaimWithRecordedApproval(request)).status).toBe(
      'completed',
    )
  })

  it('#4 does not let a stale re-issue revoke a credential rotated after its read', async () => {
    const harness = createTestHarness()
    const pending = await startPendingClaim(harness)
    await approve(harness, pending.claimSessionId)
    const proven = () =>
      completionRequest(harness, {
        claimSessionId: pending.claimSessionId,
        idempotencyKey: 'handoff',
        key: pending.key,
      }).input
    const first = await harness.devices.completeClaimWithRecordedApproval(proven())
    expect(first.status).toBe('completed')
    const deviceId = first.deviceId ?? ''

    let rotated: { credentialId: string } | undefined
    const contended = createDevices(
      interleaveAtWrite(harness.db, {
        whenWriting: REISSUE_LOCK_WRITE,
        sneak: async () => {
          rotated = await harness.devices.rotateCredential({ deviceId, credentialClass: 'command' })
        },
      }),
      { now: harness.clock.now, idGenerator: createTestIdGenerator('race') },
    )
    await contended.completeClaimWithRecordedApproval(proven())
    expect(rotated).toBeDefined()
    expect(revokedAt(harness, rotated?.credentialId ?? '')).toBeNull()
    expect((await harness.devices.getDevice(deviceId))?.revocationGeneration).toBe(1)
  })

  it('#5 refuses the second of two overlapping rotations instead of killing the first', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    let winner: { credentialId: string } | undefined
    const contended = createDevices(
      interleaveAtWrite(harness.db, {
        whenWriting: (sql) => sql.includes('insert into "devices_audit_events"'),
        sneak: async () => {
          winner = await harness.devices.rotateCredential({
            deviceId: claimed.deviceId,
            credentialClass: 'command',
          })
        },
      }),
      { now: harness.clock.now, idGenerator: createTestIdGenerator('race') },
    )
    const loser = await codeOf(
      contended.rotateCredential({ deviceId: claimed.deviceId, credentialClass: 'command' }),
    )
    expect(loser).toBe('conflict')
    expect(revokedAt(harness, winner?.credentialId ?? '')).toBeNull()
  })

  it('#6 reports a lost idempotency race as conflict, not revoked', async () => {
    const harness = createTestHarness()
    const key = createDeviceKey()
    const mint = () =>
      harness.devices.createClaimToken({ orgId: ORG, resource: VESSEL, createdByUserId: 'o' })
    const [a, b] = [await mint(), await mint()]
    const start = (service: typeof harness.devices, claimToken: string) =>
      service.startClaim({
        claimToken,
        hardwareFingerprint: FINGERPRINT,
        hardwareFingerprintAlgorithm: ALGORITHM,
        devicePublicKey: key.publicKey,
        softwareVersion: '1.0.0',
        idempotencyKey: 'shared-key',
      })
    const contended = createDevices(
      interleaveAtWrite(harness.db, {
        whenWriting: (sql) => sql.includes('insert into "devices_claim_sessions"'),
        sneak: () => start(harness.devices, a.token),
      }),
      { now: harness.clock.now, idGenerator: createTestIdGenerator('race') },
    )
    expect(await codeOf(start(contended, b.token))).toBe('conflict')
  })

  it('#7 refuses to stamp an approval on a claim that completed under it', async () => {
    const harness = createTestHarness()
    const pending = await startPendingClaim(harness)
    const stale = (
      await harness.db
        .select()
        .from(devicesClaimSessions)
        .where(eq(devicesClaimSessions.id, pending.claimSessionId))
        .all()
    ).at(0)
    const approval = await approve(harness, pending.claimSessionId)
    const completed = await harness.devices.completeClaim({
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      installationId: 'inst-1',
      hardwareFingerprint: FINGERPRINT,
      userApprovalToken: approval.token,
      approvedByUserId: 'owner-1',
      idempotencyKey: 'c',
    })
    expect(completed.status).toBe('completed')
    const hash = () =>
      harness.sqlite
        .prepare('SELECT approval_token_hash AS h FROM devices_claim_sessions WHERE id = ?')
        .get(pending.claimSessionId) as { h: string }
    const before = hash().h

    // The first claim-session read is the one taken before completion committed.
    let served = false
    const wrapper = Object.create(harness.db) as Record<string, unknown>
    wrapper.select = (fields?: unknown) => {
      const builder =
        fields === undefined ? harness.db.select() : harness.db.select(fields as never)
      return {
        from(table: unknown) {
          if (table === devicesClaimSessions && !served) {
            served = true
            const self: Record<string, unknown> = {}
            for (const method of ['where', 'orderBy', 'limit']) self[method] = () => self
            self.all = () => [stale]
            return self
          }
          return builder.from(table as never)
        },
      }
    }
    const racing = createDevices(wrapper as DevicesDatabase, {
      now: harness.clock.now,
      idGenerator: createTestIdGenerator('race'),
    })
    expect(
      await codeOf(
        racing.issueApprovalToken({
          claimSessionId: pending.claimSessionId,
          orgId: ORG,
          resource: VESSEL,
          hardwareFingerprint: FINGERPRINT,
          approvedByUserId: 'owner-1',
        }),
      ),
    ).toBe('conflict')
    expect(hash().h).toBe(before)
  })

  it('#8 prunes expired challenges', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    await harness.devices.issueChallenge({ deviceId: claimed.deviceId })
    harness.clock.advance(CHALLENGE_DEFAULT_TTL_SECONDS * 1000 + 1)
    await harness.devices.pruneExpired()
    const { n } = harness.sqlite.prepare('SELECT COUNT(*) AS n FROM devices_challenges').get() as {
      n: number
    }
    expect(n).toBe(0)
  })
})
