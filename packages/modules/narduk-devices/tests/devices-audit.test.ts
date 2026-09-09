import { describe, expect, it } from 'vitest'

import { AUDIT_EVENTS_MAX_LIMIT } from '../server/utils/devices'
import { DEVICES_AUDIT_ACTIONS } from '../shared/types/devices'

import {
  claimDevice,
  createTestHarness,
  ORG,
  signedOpen,
  startPendingClaim,
} from './support/database'

describe('audit trail', () => {
  it('writes a row for every mutation the package performs', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness

    const claimed = await claimDevice(harness)
    clock.advance(1)
    const opened = await devices.openSession((await signedOpen(harness, claimed, 'command')).input)
    clock.advance(1)
    await devices.heartbeat({ sessionId: opened.sessionId })
    clock.advance(1)
    await devices.revokeSession({ sessionId: opened.sessionId, actorUserId: 'owner-1' })
    clock.advance(1)
    await devices.rotateCredential({
      deviceId: claimed.deviceId,
      credentialClass: 'ingest',
      actorUserId: 'owner-1',
    })
    clock.advance(1)
    await devices.revokeDevice({ deviceId: claimed.deviceId, actorUserId: 'owner-1' })
    clock.advance(1)
    const pending = await startPendingClaim(harness)
    clock.advance(1)
    await devices.revokeClaimToken({ claimTokenId: pending.minted.tokenId, actorUserId: 'owner-1' })

    const events = await devices.listAuditEvents({ orgId: ORG, limit: AUDIT_EVENTS_MAX_LIMIT })
    const actions = events.map((event) => event.action)
    // Several mutations share one clock tick, so compare as a multiset.
    expect([...actions].sort()).toEqual(
      [
        'claim_token.create',
        'claim.start',
        'claim.approve',
        'claim.complete',
        'challenge.issue',
        'session.open',
        'session.revoke',
        'credential.rotate',
        'device.revoke',
        'claim_token.create',
        'claim.start',
        'claim_token.revoke',
      ].sort(),
    )
    // Every action the vocabulary names is exercised except the security
    // lockout, which the lockout suite covers.
    const exercised = new Set(actions)
    for (const action of DEVICES_AUDIT_ACTIONS) {
      if (action !== 'security.lockout') expect(exercised.has(action), action).toBe(true)
    }
    for (const event of events) {
      expect(DEVICES_AUDIT_ACTIONS).toContain(event.action)
      expect(() => JSON.parse(event.detailsJson)).not.toThrow()
    }

    // Raw tokens and secrets never reach the trail.
    const serialised = JSON.stringify(events)
    expect(serialised).not.toContain(claimed.minted.token)
    expect(serialised).not.toContain(claimed.approval.token)
    for (const credential of claimed.completed.credentials) {
      expect(serialised).not.toContain(credential.secret)
    }

    // Actors are recorded where a user acted.
    expect(events.find((event) => event.action === 'claim.complete')).toMatchObject({
      actorUserId: 'owner-1',
      subjectKind: 'device',
      subjectId: claimed.deviceId,
    })
    expect(events.find((event) => event.action === 'claim.start')).toMatchObject({
      actorUserId: null,
      subjectKind: 'claim_session',
    })
  })

  it('pages newest first, filters by subject, and clamps the limit', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const claimed = await claimDevice(harness)
    for (let index = 0; index < 3; index += 1) {
      clock.advance(1)
      await devices.issueChallenge({ deviceId: claimed.deviceId })
    }
    const all = await devices.listAuditEvents({ orgId: ORG })
    expect(all.map((event) => event.createdAt)).toEqual(
      [...all.map((event) => event.createdAt)].sort((a, b) => b - a),
    )
    const [newest] = all
    const older = await devices.listAuditEvents({ orgId: ORG, before: newest?.createdAt })
    expect(older.every((event) => event.createdAt < (newest?.createdAt ?? 0))).toBe(true)
    expect(
      await devices.listAuditEvents({ subject: { kind: 'device', id: claimed.deviceId } }),
    ).toHaveLength(4)
    expect(await devices.listAuditEvents({ orgId: ORG, limit: 2 })).toHaveLength(2)
    expect(await devices.listAuditEvents({ orgId: ORG, limit: 0 })).toHaveLength(1)
    expect((await devices.listAuditEvents({ orgId: 'other' })).length).toBe(0)
  })
})
