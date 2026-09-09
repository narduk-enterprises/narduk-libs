import { describe, expect, it } from 'vitest'

import { DEVICES_LOCKOUT_POLICY } from '../shared/utils/lockout-policy'

import {
  ALGORITHM,
  claimDevice,
  createDeviceKey,
  createTestHarness,
  FINGERPRINT,
  ORG,
  signedOpen,
  startPendingClaim,
  VESSEL,
} from './support/database'
import { errorOf } from './support/expect'

const { perTokenOrDevice, perAccountOrIp } = DEVICES_LOCKOUT_POLICY

describe('lockouts', () => {
  it('locks a claim token after five failures: the sixth attempt is rate_limited', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const pending = await startPendingClaim(harness)
    const complete = {
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      installationId: 'inst-1',
      hardwareFingerprint: FINGERPRINT,
      userApprovalToken: 'guess',
      approvedByUserId: 'owner-1',
      idempotencyKey: 'complete-1',
    }
    for (let attempt = 1; attempt <= perTokenOrDevice.failures; attempt += 1) {
      expect((await devices.completeClaim(complete)).status, `attempt ${attempt}`).toBe(
        'approval_required',
      )
      clock.advance(1000)
    }
    const sixth = await devices.completeClaim(complete)
    expect(sixth).toEqual({
      status: 'rate_limited',
      credentials: [],
      retryAfterSeconds: perTokenOrDevice.cooldownSeconds - 1,
    })

    // The same token is locked for a fresh start too, and a start against the
    // token counts the same subject.
    const started = await devices.startClaim({
      claimToken: pending.minted.token,
      hardwareFingerprint: FINGERPRINT,
      hardwareFingerprintAlgorithm: ALGORITHM,
      devicePublicKey: pending.key.publicKey,
      softwareVersion: '1.0.0',
      idempotencyKey: 'start-locked',
    })
    expect(started).toMatchObject({ claimSessionId: null, status: 'rate_limited' })
    expect(started.retryAfterSeconds).toBe(perTokenOrDevice.cooldownSeconds - 1)

    // A rate-limited refusal is not itself a failure, so the cooldown ends —
    // and because the cooldown equals the claim token TTL, a locked token is
    // dead by the time it lifts rather than guessable again.
    clock.advance((perTokenOrDevice.cooldownSeconds - 1) * 1000)
    expect((await devices.completeClaim(complete)).status).toBe('expired')
  })

  it('locks a device after five failed session opens', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const claimed = await claimDevice(harness)
    for (let attempt = 1; attempt <= perTokenOrDevice.failures; attempt += 1) {
      const { input } = await signedOpen(harness, claimed, 'command')
      const error = await errorOf(devices.openSession({ ...input, signature: 'A'.repeat(86) }))
      expect(error.code, `attempt ${attempt}`).toBe('unauthorized')
      clock.advance(1000)
    }
    const { input } = await signedOpen(harness, claimed, 'command')
    const sixth = await errorOf(devices.openSession(input))
    expect(sixth.code).toBe('rate_limited')
    expect(sixth.retryAfterSeconds).toBe(perTokenOrDevice.cooldownSeconds - 1)

    // Once the cooldown lifts, a correctly signed open succeeds again.
    clock.advance((perTokenOrDevice.cooldownSeconds - 1) * 1000)
    const { input: valid } = await signedOpen(harness, claimed, 'command')
    await expect(devices.openSession(valid)).resolves.toMatchObject({ revocationGeneration: 0 })
  })

  it('locks an IP after twenty failures across tokens, escalates, and audits', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const key = createDeviceKey()
    const remote = { ip: '203.0.113.7' }
    const attempt = (n: number) =>
      devices.startClaim({
        claimToken: `guess-${String(n).padStart(3, '0')}-000000000000000000000000000000`,
        hardwareFingerprint: FINGERPRINT,
        hardwareFingerprintAlgorithm: ALGORITHM,
        devicePublicKey: key.publicKey,
        softwareVersion: '1.0.0',
        idempotencyKey: `idem-${n}`,
        remote,
      })

    // Every guess is a different token, so no per-token lockout fires.
    for (let n = 1; n <= perAccountOrIp.failures; n += 1) {
      expect((await attempt(n)).status, `attempt ${n}`).toBe('invalid_token')
      clock.advance(1000)
    }
    const twentyFirst = await attempt(21)
    expect(twentyFirst.status).toBe('rate_limited')
    expect(twentyFirst.retryAfterSeconds).toBe(perAccountOrIp.cooldownSeconds - 1)

    const lockouts = (await devices.listAuditEvents()).filter(
      (event) => event.action === 'security.lockout',
    )
    expect(lockouts).toHaveLength(1)
    expect(lockouts[0]).toMatchObject({ orgId: null, subjectKind: 'ip', subjectId: remote.ip })
    expect(JSON.parse(lockouts[0]?.detailsJson ?? '{}')).toEqual({
      failures: 20,
      cooldownSeconds: 900,
      reason: 'invalid_token',
    })

    // After the first cooldown, twenty more failures inside the hour escalate.
    clock.advance(perAccountOrIp.cooldownSeconds * 1000)
    for (let n = 22; n <= 41; n += 1) {
      expect((await attempt(n)).status, `attempt ${n}`).toBe('invalid_token')
    }
    const escalated = await attempt(42)
    expect(escalated.status).toBe('rate_limited')
    expect(escalated.retryAfterSeconds).toBe(perAccountOrIp.cooldownSeconds * 2)
    const second = (await devices.listAuditEvents()).filter(
      (event) => event.action === 'security.lockout',
    )
    expect(second).toHaveLength(2)
    expect(JSON.parse(second[0]?.detailsJson ?? '{}')).toMatchObject({
      failures: 40,
      cooldownSeconds: 1800,
    })

    // An unrelated IP is unaffected.
    const other = await devices.startClaim({
      claimToken: 'guess-999-000000000000000000000000000000',
      hardwareFingerprint: FINGERPRINT,
      hardwareFingerprintAlgorithm: ALGORITHM,
      devicePublicKey: key.publicKey,
      softwareVersion: '1.0.0',
      idempotencyKey: 'idem-other',
      remote: { ip: '198.51.100.9' },
    })
    expect(other.status).toBe('invalid_token')
  })

  it('counts the approving account as a subject of a failed completion', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const pending = await startPendingClaim(harness)
    await devices.completeClaim({
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      installationId: 'inst-1',
      hardwareFingerprint: FINGERPRINT,
      userApprovalToken: 'guess',
      approvedByUserId: 'owner-1',
      idempotencyKey: 'c',
      remote: { ip: '203.0.113.7', accountKey: 'ignored-in-favour-of-approver' },
    })
    const attempts = harness.sqlite
      .prepare('SELECT subject_kind, subject FROM devices_auth_attempts ORDER BY subject_kind')
      .all() as Array<{ subject: string; subject_kind: string }>
    expect(attempts.filter((row) => row.subject_kind === 'account')).toEqual([
      { subject_kind: 'account', subject: 'owner-1' },
    ])
    // The earlier successful start recorded its token; the failed completion
    // recorded token, approver account and IP.
    expect(attempts.map((row) => row.subject_kind).sort()).toEqual([
      'account',
      'ip',
      'token',
      'token',
    ])
  })
})
