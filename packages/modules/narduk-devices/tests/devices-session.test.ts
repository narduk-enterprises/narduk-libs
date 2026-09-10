import { describe, expect, it } from 'vitest'

import {
  CHALLENGE_DEFAULT_TTL_SECONDS,
  isWithinTimestampSkew,
  SESSION_DEFAULT_TTL_SECONDS,
  TIMESTAMP_SKEW_DEFAULT_SECONDS,
} from '../server/utils/devices'

import { claimDevice, createDeviceKey, createTestHarness, signedOpen } from './support/database'
import { codeOf, errorOf } from './support/expect'

import type { DevicesError } from '../server/utils/devices-error'

describe('device sessions', () => {
  it('opens a session from a signed canonical request', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const claimed = await claimDevice(harness)
    const { input, challenge } = await signedOpen(harness, claimed, 'command')
    expect(challenge.expiresAt).toBe(clock.now() + CHALLENGE_DEFAULT_TTL_SECONDS * 1000)

    const opened = await devices.openSession(input)
    expect(opened).toEqual({
      sessionId: expect.stringMatching(/^id-/u),
      sessionToken: expect.stringMatching(/^token-/u),
      expiresAt: clock.now() + SESSION_DEFAULT_TTL_SECONDS * 1000,
      revocationGeneration: 0,
    })
    // The bearer is a secret of its own: not the row id, and stored only as a digest.
    expect(opened.sessionToken).not.toBe(opened.sessionId)
    expect(await devices.getSessionByToken(opened.sessionToken)).toMatchObject({
      id: opened.sessionId,
    })
    expect(await devices.getSessionByToken(opened.sessionId)).toBeNull()
    expect(await devices.getSession(opened.sessionId)).toMatchObject({
      deviceId: claimed.deviceId,
      credentialClass: 'command',
      credentialId: claimed.command.credentialId,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
    })

    // A client nonce is accepted when paired with the cloud-issued challenge.
    const client = await signedOpen(harness, claimed, 'ingest', { nonce: 'client-nonce-1' })
    await expect(devices.openSession(client.input)).resolves.toMatchObject({
      revocationGeneration: 0,
    })

    clock.advance(SESSION_DEFAULT_TTL_SECONDS * 1000)
    expect(await devices.getSession(opened.sessionId)).toBeNull()
    expect(await devices.getSessionByToken(opened.sessionToken)).toBeNull()
    expect(await codeOf(devices.heartbeat({ sessionId: opened.sessionId }))).toBe('expired')
    expect(await codeOf(devices.heartbeat({ sessionToken: opened.sessionToken }))).toBe('expired')
  })

  it('refuses a bad signature, a foreign key and a skewed timestamp', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const claimed = await claimDevice(harness)

    const tampered = await signedOpen(harness, claimed, 'command')
    const error = await errorOf(
      devices.openSession({
        ...tampered.input,
        canonicalRequest: { ...tampered.request, requestHash: 'sha256:tampered' },
      }),
    )
    expect(error.code).toBe('unauthorized')
    expect(error.message).toContain('signature mismatch')

    const impostor = createDeviceKey()
    const foreign = await signedOpen(harness, claimed, 'command')
    expect(
      await codeOf(
        devices.openSession({ ...foreign.input, signature: impostor.sign(foreign.request) }),
      ),
    ).toBe('unauthorized')
    expect(
      await codeOf(devices.openSession({ ...foreign.input, signature: 'not base64url!' })),
    ).toBe('unauthorized')

    const stale = await signedOpen(harness, claimed, 'command', {
      timestamp: clock.now() - TIMESTAMP_SKEW_DEFAULT_SECONDS * 1000 - 1,
    })
    expect((await errorOf(devices.openSession(stale.input))).message).toContain('skew')
    const future = await signedOpen(harness, claimed, 'command', {
      timestamp: clock.now() + TIMESTAMP_SKEW_DEFAULT_SECONDS * 1000,
    })
    await expect(devices.openSession(future.input)).resolves.toBeDefined()
  })

  /**
   * narduk-libs#228 M4. `isWithinTimestampSkew` shipped as the rule a consumer
   * should use for its own pre-device exchange while `openSession` still
   * carried an inline copy — the drift the helper existed to prevent was the
   * one thing not implemented. This drives both across the same boundary, at a
   * *non-default* window so a re-introduced hardcoded default fails here.
   */
  it('bounds openSession by the same window isWithinTimestampSkew reports', async () => {
    const skewSeconds = 7
    const harness = createTestHarness({ timestampSkewSeconds: skewSeconds })
    const { devices, clock } = harness
    const claimed = await claimDevice(harness)
    const edge = skewSeconds * 1000

    // `null` where the window accepts, the refusal reason where it does not.
    const opens = async (timestamp: number): Promise<string | null> => {
      const attempt = await signedOpen(harness, claimed, 'command', { timestamp })
      try {
        await devices.openSession(attempt.input)
        return null
      } catch (error) {
        return (error as DevicesError).message
      }
    }

    const offsets = [-edge - 1, -edge, -1, 0, 1, edge, edge + 1, Number.NaN]
    const helper: boolean[] = []
    const session: boolean[] = []
    for (const offset of offsets) {
      const timestamp = clock.now() + offset
      helper.push(isWithinTimestampSkew(timestamp, clock.now(), skewSeconds))

      const refusal = await opens(timestamp)
      // A refusal must be *this* rule, not some other check that happens to
      // reject: anything else would make the two look equal by accident.
      if (refusal !== null) expect(refusal, `offset ${String(offset)}ms`).toContain('skew')
      session.push(refusal === null)
    }
    expect(session).toEqual(helper)
    // ...and the sweep really did cross the boundary rather than agreeing on
    // one uniform answer.
    expect(new Set(helper)).toEqual(new Set([true, false]))
  })

  it('refuses a replayed request and an expired challenge', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const claimed = await claimDevice(harness)

    // Replay: the identical signed request presented again.
    const once = await signedOpen(harness, claimed, 'command')
    await expect(devices.openSession(once.input)).resolves.toBeDefined()
    const replayed = await errorOf(devices.openSession(once.input))
    expect(replayed.code).toBe('unauthorized')
    expect(replayed.message).toContain('replayed')
    // The same challenge with a different nonce is a new request, not a replay.
    const reuse = await signedOpen(harness, claimed, 'command', {
      challengeId: once.challenge.challengeId,
      nonce: 'second-nonce',
    })
    await expect(devices.openSession(reuse.input)).resolves.toBeDefined()

    // Challenge expiry ends both the challenge and its replay window.
    const late = await signedOpen(harness, claimed, 'command')
    clock.advance(CHALLENGE_DEFAULT_TTL_SECONDS * 1000)
    expect((await errorOf(devices.openSession(late.input))).message).toContain('challenge')
  })

  it('refuses request bindings that do not match the device or credential', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const claimed = await claimDevice(harness)
    for (const override of [
      { deviceId: 'other-device' },
      { installationId: 'inst-2' },
      { resource: { kind: 'vessel', id: 'vessel-2' } },
      { credentialVersion: 2 },
    ]) {
      const { input } = await signedOpen(harness, claimed, 'command', override)
      const error = await errorOf(devices.openSession(input))
      expect(error.code).toBe('unauthorized')
      expect(error.message).toContain('binding')
    }
    const unknown = await signedOpen(harness, claimed, 'command')
    expect(await codeOf(devices.openSession({ ...unknown.input, deviceId: 'ghost' }))).toBe(
      'unauthorized',
    )
    expect(await codeOf(devices.openSession({ ...unknown.input, credentialId: 'ghost' }))).toBe(
      'unauthorized',
    )
    expect(await codeOf(devices.issueChallenge({ deviceId: 'ghost' }))).toBe('not_found')
  })

  it('never lets an ingest credential open a command session', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const claimed = await claimDevice(harness)
    const { input } = await signedOpen(harness, claimed, 'command')
    const crossed = await errorOf(
      devices.openSession({ ...input, credentialId: claimed.ingest.credentialId }),
    )
    expect(crossed.code).toBe('forbidden')
    expect(crossed.message).toContain('class')
    // And the other way round: a command credential is not an ingest credential.
    const reverse = await signedOpen(harness, claimed, 'ingest')
    expect(
      await codeOf(
        devices.openSession({ ...reverse.input, credentialId: claimed.command.credentialId }),
      ),
    ).toBe('forbidden')
  })

  it('binds the credential into the signature, so a signed body cannot be re-aimed', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const claimed = await claimDevice(harness)

    // A valid, ingest-signed body. Everything an ingest-tier process, a retry
    // queue or a log could hold on to.
    const ingestSigned = await signedOpen(harness, claimed, 'ingest')
    expect(ingestSigned.request.credentialClass).toBe('ingest')
    expect(ingestSigned.request.credentialId).toBe(claimed.ingest.credentialId)

    // Replayed verbatim with only the unsigned envelope rewritten to ask for a
    // command session. The signature still verifies; the binding does not.
    const escalated = await errorOf(
      devices.openSession({
        ...ingestSigned.input,
        credentialClass: 'command',
        credentialId: claimed.command.credentialId,
      }),
    )
    expect(escalated.code).toBe('unauthorized')
    expect(escalated.message).toContain('binding')
    expect(
      harness.sqlite
        .prepare("SELECT id FROM devices_sessions WHERE credential_class = 'command'")
        .all(),
    ).toEqual([])

    // The same rewrite in the other direction is refused too.
    const commandSigned = await signedOpen(harness, claimed, 'command')
    expect(
      await codeOf(
        devices.openSession({
          ...commandSigned.input,
          credentialClass: 'ingest',
          credentialId: claimed.ingest.credentialId,
        }),
      ),
    ).toBe('unauthorized')

    // And a signed body naming a credential that is not the one presented.
    const forged = await signedOpen(harness, claimed, 'command', {
      credentialId: claimed.ingest.credentialId,
    })
    expect(
      await codeOf(
        devices.openSession({
          ...forged.input,
          credentialId: claimed.command.credentialId,
        }),
      ),
    ).toBe('unauthorized')

    // The unmodified ingest body is still good, which is what makes the
    // rejections above about the rewrite and not about the body.
    await expect(devices.openSession(ingestSigned.input)).resolves.toMatchObject({
      revocationGeneration: 0,
    })
  })

  it('refuses a signature base64url cannot decode without throwing a DOMException', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const claimed = await claimDevice(harness)

    // 85 characters: a legal base64url alphabet, an impossible length
    // (85 % 4 === 1), which is exactly what makes `atob` throw.
    const malformed = 'A'.repeat(85)
    expect(malformed.length % 4).toBe(1)
    const { input } = await signedOpen(harness, claimed, 'command')
    const error = await errorOf(devices.openSession({ ...input, signature: malformed }))
    expect(error.code).toBe('unauthorized')
    expect(error.message).toContain('malformed signature')

    // It counted as a failure, so it cannot be repeated for free.
    const attempts = harness.sqlite
      .prepare(
        "SELECT subject FROM devices_auth_attempts WHERE outcome = 'failure' AND subject_kind = 'device'",
      )
      .all() as Array<{ subject: string }>
    expect(attempts).toEqual([{ subject: claimed.deviceId }])
  })

  it('heartbeats, revokes sessions, and reports a stale generation after device revocation', async () => {
    const harness = createTestHarness()
    const { devices, clock } = harness
    const claimed = await claimDevice(harness)
    const { input } = await signedOpen(harness, claimed, 'command')
    const opened = await devices.openSession(input)

    clock.advance(30_000)
    // Both selectors resolve the same session; the device path presents its bearer.
    expect(await devices.heartbeat({ sessionToken: opened.sessionToken })).toMatchObject({
      sessionId: opened.sessionId,
    })
    expect(await devices.heartbeat({ sessionId: opened.sessionId })).toEqual({
      sessionId: opened.sessionId,
      expiresAt: opened.expiresAt,
      revocationGeneration: 0,
      deviceRevocationGeneration: 0,
      stale: false,
    })
    expect((await devices.getSession(opened.sessionId))?.lastSeenAt).toBe(clock.now())

    const revoked = await devices.revokeSession({
      sessionId: opened.sessionId,
      actorUserId: 'owner-1',
      reason: 'test',
    })
    expect(revoked.revokedAt).toBe(clock.now())
    expect(await devices.getSession(opened.sessionId)).toBeNull()
    expect(await codeOf(devices.heartbeat({ sessionId: opened.sessionId }))).toBe('revoked')
    // Idempotent.
    expect((await devices.revokeSession({ sessionId: opened.sessionId })).revokedAt).toBe(
      revoked.revokedAt,
    )
    expect(await codeOf(devices.revokeSession({ sessionId: 'ghost' }))).toBe('not_found')
    expect(await codeOf(devices.heartbeat({ sessionId: 'ghost' }))).toBe('not_found')
    expect(await codeOf(devices.heartbeat({ sessionToken: 'ghost' }))).toBe('not_found')

    const second = await devices.openSession((await signedOpen(harness, claimed, 'ingest')).input)
    const device = await devices.revokeDevice({
      deviceId: claimed.deviceId,
      actorUserId: 'owner-1',
    })
    expect(device).toMatchObject({ status: 'revoked', revocationGeneration: 1 })
    expect(await devices.getSession(second.sessionId)).toBeNull()
    expect(await devices.listDevices({ orgId: 'org-1' })).toEqual([])
    expect(await devices.listDevices({ orgId: 'org-1', includeRevoked: true })).toHaveLength(1)
    expect(await codeOf(devices.issueChallenge({ deviceId: claimed.deviceId }))).toBe('revoked')
    expect(await codeOf(devices.openSession(input))).toBe('revoked')
    expect(
      await devices.verifyCredentialSecret({
        credentialId: claimed.ingest.credentialId,
        secret: claimed.ingest.secret,
      }),
    ).toBeNull()
    // Idempotent.
    expect((await devices.revokeDevice({ deviceId: claimed.deviceId })).revocationGeneration).toBe(
      1,
    )
    expect(await codeOf(devices.revokeDevice({ deviceId: 'ghost' }))).toBe('not_found')
  })

  it('rotates a credential class, bumps the generation, and ends that class of session', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const claimed = await claimDevice(harness)
    const command = await devices.openSession((await signedOpen(harness, claimed, 'command')).input)
    const ingest = await devices.openSession((await signedOpen(harness, claimed, 'ingest')).input)

    const rotated = await devices.rotateCredential({
      deviceId: claimed.deviceId,
      credentialClass: 'command',
      actorUserId: 'owner-1',
    })
    expect(rotated).toMatchObject({ credentialClass: 'command', version: 2 })
    expect(rotated.secret).not.toBe(claimed.command.secret)
    expect((await devices.getDevice(claimed.deviceId))?.revocationGeneration).toBe(1)

    // The command session is gone and stale; the ingest session survives.
    expect(await devices.getSession(command.sessionId)).toBeNull()
    expect(await devices.heartbeat({ sessionId: ingest.sessionId })).toMatchObject({
      revocationGeneration: 0,
      deviceRevocationGeneration: 1,
      stale: true,
    })

    // The old command credential no longer opens anything; the new one does,
    // and only at its own version.
    const old = await signedOpen(harness, claimed, 'command')
    expect(await codeOf(devices.openSession(old.input))).toBe('unauthorized')
    const fresh = await signedOpen(harness, claimed, 'command', {
      credentialId: rotated.credentialId,
      credentialVersion: 2,
    })
    await expect(devices.openSession(fresh.input)).resolves.toMatchObject({
      revocationGeneration: 1,
    })
    expect(
      await devices.verifyCredentialSecret({
        credentialId: rotated.credentialId,
        secret: rotated.secret,
      }),
    ).toMatchObject({ version: 2 })

    // Rotation honours an expiry and refuses a revoked device or a bad expiry.
    const expiring = await devices.rotateCredential({
      deviceId: claimed.deviceId,
      credentialClass: 'ingest',
      expiresAt: harness.clock.now() + 1000,
    })
    expect(expiring.expiresAt).toBe(harness.clock.now() + 1000)
    harness.clock.advance(1000)
    expect(
      await devices.verifyCredentialSecret({
        credentialId: expiring.credentialId,
        secret: expiring.secret,
      }),
    ).toBeNull()
    expect(
      await codeOf(
        devices.rotateCredential({
          deviceId: claimed.deviceId,
          credentialClass: 'ingest',
          expiresAt: -1,
        }),
      ),
    ).toBe('invalid')
    await devices.revokeDevice({ deviceId: claimed.deviceId })
    expect(
      await codeOf(
        devices.rotateCredential({ deviceId: claimed.deviceId, credentialClass: 'ingest' }),
      ),
    ).toBe('revoked')
  })

  it('accepts an injected verifier', async () => {
    const harness = createTestHarness({ verifySignature: async () => false })
    const claimed = await claimDevice(harness)
    const { input } = await signedOpen(harness, claimed, 'command')
    expect(await codeOf(harness.devices.openSession(input))).toBe('unauthorized')
  })
})
