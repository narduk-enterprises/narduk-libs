import { describe, expect, it } from 'vitest'

import { AUDIT_EVENTS_MAX_LIMIT } from '../server/utils/devices'
import { DEVICES_AUDIT_ACTIONS } from '../shared/types/devices'

import {
  claimDevice,
  completionRequest,
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
    // A replayed completion, opted in and proved, re-issues rather than
    // serving an empty array.
    await devices.completeClaimWithRecordedApproval(
      completionRequest(harness, {
        claimSessionId: claimed.claimSessionId,
        idempotencyKey: `complete-${claimed.claimSessionId}`,
        key: claimed.key,
      }).input,
    )
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
        'claim.reissue',
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

  it('never records the session bearer, in an audit row or anywhere in the database', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const claimed = await claimDevice(harness)
    const opened = await devices.openSession((await signedOpen(harness, claimed, 'command')).input)

    // The audit row names the session by its non-bearer row id.
    const events = await devices.listAuditEvents({
      subject: { kind: 'session', id: opened.sessionId },
    })
    expect(events.map((event) => event.action)).toEqual(['session.open'])
    expect(opened.sessionId).not.toBe(opened.sessionToken)

    // No table, no column, anywhere, holds the raw bearer — only its digest.
    const tables = harness.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'devices_%'")
      .all() as Array<{ name: string }>
    for (const { name } of tables) {
      const rows = harness.sqlite.prepare(`SELECT * FROM ${name}`).all()
      expect(JSON.stringify(rows), name).not.toContain(opened.sessionToken)
    }
    const stored = harness.sqlite
      .prepare('SELECT id, token_hash FROM devices_sessions')
      .all() as Array<{ id: string; token_hash: string }>
    expect(stored).toHaveLength(1)
    expect(stored[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/u)
    expect(stored[0]?.id).toBe(opened.sessionId)

    // The revocation audit row names the row id too, even when the caller
    // revoked by presenting the bearer.
    await devices.revokeSession({ sessionToken: opened.sessionToken, actorUserId: 'owner-1' })
    const revocations = await devices.listAuditEvents({
      subject: { kind: 'session', id: opened.sessionId },
    })
    expect(revocations.map((event) => event.action).sort()).toEqual([
      'session.open',
      'session.revoke',
    ])
    expect(JSON.stringify(revocations)).not.toContain(opened.sessionToken)
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
