import { describe, expect, it } from 'vitest'

import { createDevices } from '../server/utils/devices'

import {
  claimDevice,
  createTestHarness,
  FINGERPRINT,
  ORG,
  signedOpen,
  startPendingClaim,
  VESSEL,
} from './support/database'
import { codeOf } from './support/expect'

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
