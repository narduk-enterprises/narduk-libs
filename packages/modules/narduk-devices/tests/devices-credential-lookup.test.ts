import { describe, expect, it } from 'vitest'

import type { CredentialSecretLookupOptions } from '../server/utils/devices'
import { lockoutSubjectFor } from '../server/utils/devices-lockout'
import { sha256Hex, timingSafeEqualHex } from '../server/utils/devices-signing'
import { DEVICES_LOCKOUT_POLICY } from '../shared/utils/lockout-policy'

import { claimDevice, createTestHarness, FINGERPRINT, ORG, VESSEL } from './support/database'
import { codeOf, errorOf } from './support/expect'

/**
 * Gap L2: the built mybo edge presents only the raw credential *secret* as its
 * bearer -- no credential id -- so 0.1.0's `verifyCredentialSecret({
 * credentialId, secret })` could not be reached at all, and `secret_hash` had no
 * index to reach it through. Resolution is by digest against a UNIQUE
 * `secret_hash` index, the mirror of `getSessionByToken`.
 */
/** How many failed authentication attempts the whole harness has recorded. */
function failedAttempts(harness: ReturnType<typeof createTestHarness>): number {
  return (
    harness.sqlite
      .prepare("SELECT COUNT(*) AS n FROM devices_auth_attempts WHERE outcome = 'failure'")
      .get() as { n: number }
  ).n
}

/** How many failures the harness has recorded against one exact stored subject. */
function failuresFor(harness: ReturnType<typeof createTestHarness>, subject: string): number {
  return (
    harness.sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM devices_auth_attempts WHERE outcome = 'failure' AND subject = ?",
      )
      .get(subject) as { n: number }
  ).n
}

describe('credential lookup by bare secret', () => {
  it('resolves each class of active credential from its secret alone', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)

    const ingest = await harness.devices.getCredentialBySecret(claimed.ingest.secret, {
      unattributed: true,
    })
    expect(ingest).toMatchObject({
      id: claimed.ingest.credentialId,
      credentialClass: 'ingest',
      deviceId: claimed.deviceId,
      version: 1,
    })

    const command = await harness.devices.getCredentialBySecret(claimed.command.secret, {
      unattributed: true,
    })
    expect(command).toMatchObject({
      id: claimed.command.credentialId,
      credentialClass: 'command',
      deviceId: claimed.deviceId,
    })
    // The row carries the digest, never the secret.
    expect(ingest?.secretHash).toBe(await sha256Hex(claimed.ingest.secret))
    expect(JSON.stringify(ingest)).not.toContain(claimed.ingest.secret)
  })

  it('returns null rather than throwing for an unknown or malformed secret', async () => {
    const harness = createTestHarness()
    await claimDevice(harness)
    const candidates = ['', 'not-a-secret', ' ', 'a'.repeat(4096)]
    const resolved = await Promise.all(
      candidates.map(async (candidate) =>
        harness.devices.getCredentialBySecret(candidate, { unattributed: true }),
      ),
    )
    expect(resolved).toEqual([null, null, null, null])
  })

  it('stops resolving a rotated secret and resolves its replacement', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    harness.clock.advance(1000)
    const rotated = await harness.devices.rotateCredential({
      deviceId: claimed.deviceId,
      credentialClass: 'ingest',
      actorUserId: 'owner-1',
    })

    await expect(
      harness.devices.getCredentialBySecret(claimed.ingest.secret, { unattributed: true }),
    ).resolves.toBeNull()
    await expect(
      harness.devices.getCredentialBySecret(rotated.secret, { unattributed: true }),
    ).resolves.toMatchObject({
      id: rotated.credentialId,
      version: 2,
    })
    // The other class is untouched.
    await expect(
      harness.devices.getCredentialBySecret(claimed.command.secret, { unattributed: true }),
    ).resolves.not.toBeNull()
  })

  it('stops resolving an expired credential', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    const expiresAt = harness.clock.now() + 60_000
    const issued = await harness.devices.rotateCredential({
      deviceId: claimed.deviceId,
      credentialClass: 'command',
      actorUserId: 'owner-1',
      expiresAt,
    })
    await expect(
      harness.devices.getCredentialBySecret(issued.secret, { unattributed: true }),
    ).resolves.not.toBeNull()
    harness.clock.set(expiresAt)
    await expect(
      harness.devices.getCredentialBySecret(issued.secret, { unattributed: true }),
    ).resolves.toBeNull()
  })

  it('stops resolving every credential of a revoked device', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    await harness.devices.revokeDevice({ deviceId: claimed.deviceId, actorUserId: 'owner-1' })
    await expect(
      harness.devices.getCredentialBySecret(claimed.ingest.secret, { unattributed: true }),
    ).resolves.toBeNull()
    await expect(
      harness.devices.getCredentialBySecret(claimed.command.secret, { unattributed: true }),
    ).resolves.toBeNull()
  })

  it('refuses to store two credentials behind one digest', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    const digest = await sha256Hex(claimed.ingest.secret)
    expect(() =>
      harness.sqlite
        .prepare(
          'INSERT INTO devices_credentials (id, device_id, credential_class, secret_hash, fingerprint, version, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('clone-1', claimed.deviceId, 'ingest', digest, 'sha256:clone', 9, 1),
    ).toThrow(/UNIQUE constraint failed/u)
  })

  // Named for what it proves. It takes no timing measurement, so it is an
  // equality contract for `timingSafeEqualHex`, not evidence of constant time
  // — swap the body for `===` and this still passes (narduk-libs#228 M1).
  it('equates two digests only when every byte matches, first byte to last', () => {
    const digest = 'a'.repeat(64)
    expect(timingSafeEqualHex(digest, digest)).toBe(true)
    expect(timingSafeEqualHex(digest, `b${digest.slice(1)}`)).toBe(false)
    expect(timingSafeEqualHex(digest, `${digest.slice(0, 63)}b`)).toBe(false)
    expect(timingSafeEqualHex(digest, digest.slice(0, 63))).toBe(false)
  })

  /**
   * narduk-libs#228 M2. A completion-issued secret never expires, so this
   * resolver is a permanent bearer — and it used to record nothing at all, so
   * a credential-stuffing sweep across a fleet left no trace anywhere and ran
   * unbounded. Guessing a 256-bit secret is infeasible; being unable to *see*
   * someone try is the part that had to change.
   */
  it('counts a failed bare-secret resolution against the lockout and refuses once locked', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    const remote = { ip: '203.0.113.44' }
    const failures = () => failedAttempts(harness)
    const before = failures()

    for (let n = 0; n < DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures; n += 1) {
      await expect(
        harness.devices.getCredentialBySecret(`guess-${String(n)}`, { remote }),
      ).resolves.toBeNull()
      harness.clock.advance(1000)
    }
    // Every miss left a row, which is what the sweep used to avoid entirely.
    expect(failures() - before).toBe(DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures)

    // Locked: even the genuine secret is refused from this IP, so the sweep is
    // bounded rather than merely logged.
    await expect(
      harness.devices.getCredentialBySecret(claimed.ingest.secret, { remote }),
    ).resolves.toBeNull()
    // ...and the lockout is scoped to the subject, not to the credential: the
    // device's own secret still resolves from another IP, which is a counted
    // subject in its own right rather than an unattributed lookup.
    await expect(
      harness.devices.getCredentialBySecret(claimed.ingest.secret, {
        remote: { ip: '198.51.100.9' },
      }),
    ).resolves.not.toBeNull()
  })

  /**
   * narduk-libs#228 second review H1. Devices aboard one vessel share a public
   * IP and the edge presents its bearer on *every* ingest request, so counting
   * a stale-but-known credential as an authentication failure lets one device
   * that has not yet adopted its replacement secret take the whole boat's
   * cameras off the air. The reviewer's six-hour simulation put the healthy
   * neighbour dark 99.7% of the time with no attacker present.
   *
   * The distinction that has to hold: credential stuffing produces *unknown*
   * digests; a revoked or expired row is a known-good credential gone stale,
   * from a caller that has already proved it held it once.
   */
  it('never counts a revoked or expired credential against the shared subject', async () => {
    const harness = createTestHarness()
    const stale = await claimDevice(harness)
    const neighbour = await claimDevice(harness)
    // Exactly what this package's own re-issue, `rotateCredential` and
    // `revokeDevice` all do to a secret the device is still presenting.
    await harness.devices.rotateCredential({
      deviceId: stale.deviceId,
      credentialClass: 'ingest',
      actorUserId: 'owner-1',
    })
    const expiring = await harness.devices.rotateCredential({
      deviceId: stale.deviceId,
      credentialClass: 'command',
      actorUserId: 'owner-1',
      expiresAt: harness.clock.now() + 60_000,
    })
    harness.clock.advance(60_001)

    const remote = { ip: '203.0.113.7' }
    const attempts = () => failedAttempts(harness)
    const before = attempts()
    // Well past `perAccountOrIp.failures`, which is the whole point: the edge
    // retries on every request, not once.
    for (let n = 0; n < DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures * 2; n += 1) {
      await expect(
        harness.devices.getCredentialBySecret(stale.ingest.secret, { remote }),
      ).resolves.toBeNull()
      await expect(
        harness.devices.getCredentialBySecret(expiring.secret, { remote }),
      ).resolves.toBeNull()
      harness.clock.advance(1000)
    }
    // Nothing counted, so nothing to escalate.
    expect(attempts() - before).toBe(0)
    // ...and the neighbour on the same IP is still served, which is the whole
    // finding.
    await expect(
      harness.devices.getCredentialBySecret(neighbour.ingest.secret, { remote }),
    ).resolves.not.toBeNull()

    // M2's value is untouched: an *unknown* digest is still a guess, still
    // counted, and still locks the shared subject.
    for (let n = 0; n < DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures; n += 1) {
      await expect(
        harness.devices.getCredentialBySecret(`guess-${String(n)}`, { remote }),
      ).resolves.toBeNull()
      harness.clock.advance(1000)
    }
    expect(attempts() - before).toBe(DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures)
    await expect(
      harness.devices.getCredentialBySecret(neighbour.ingest.secret, { remote }),
    ).resolves.toBeNull()
  })

  /**
   * narduk-libs#228 third review HIGH-4. The second round closed H1 by not
   * counting a stale credential — and then re-opened the same outage through
   * another door: an unknown `claimSessionId` was counted against the caller's
   * IP, and lockout subjects were not namespaced by operation, so the claim
   * ceremony's counter *was* the ingest lookup's counter.
   *
   * That writer is the worst possible one to share with: it carries no claim
   * token, no approval and no proof, and — unlike every other completion
   * refusal — no per-token subject, so nothing caps it at five. The reviewer's
   * PROBE A drove it to twenty from one IP and the healthy neighbour's ingest
   * lookup was REFUSED.
   *
   * This is that probe, with the answer it must give now.
   */
  it('serves the vessel ingest lookup through a claim-path enumeration storm', async () => {
    const harness = createTestHarness()
    const neighbour = await claimDevice(harness)
    const remote = { ip: '203.0.113.77' }
    // PROBE A: completions naming session ids that do not exist. No token, no
    // approval, no proof — the cheapest unauthenticated writer in the package.
    const guess = (n: number) =>
      harness.devices.completeClaim({
        claimSessionId: `invented-${String(n)}`,
        orgId: ORG,
        resource: VESSEL,
        installationId: 'inst-1',
        hardwareFingerprint: FINGERPRINT,
        userApprovalToken: 'whatever',
        approvedByUserId: 'owner-1',
        idempotencyKey: `probe-a-${String(n)}`,
        remote,
      })
    for (let n = 0; n < DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures; n += 1) {
      expect(await codeOf(guess(n)), `guess ${String(n)}`).toBe('not_found')
      harness.clock.advance(1000)
    }

    // The storm landed: the claim ceremony is locked for this IP, which is
    // exactly what L1 asked for and must stay true.
    await expect(guess(999)).resolves.toMatchObject({ status: 'rate_limited', credentials: [] })
    expect(failuresFor(harness, lockoutSubjectFor('claim', remote.ip))).toBe(
      DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures,
    )
    // ...and it wrote nothing at all into the counter the ingest path reads.
    expect(failuresFor(harness, lockoutSubjectFor('credential', remote.ip))).toBe(0)

    // The finding, in one assertion: the neighbouring camera on the vessel's
    // shared IP is still SERVED.
    await expect(
      harness.devices.getCredentialBySecret(neighbour.ingest.secret, { remote }),
    ).resolves.toMatchObject({ id: neighbour.ingest.credentialId })
  })

  /**
   * The other direction of HIGH-4: a credential-stuffing sweep must still be
   * bounded on its own path, and must not lock a device out of the claim
   * ceremony it needs to recover with.
   */
  it('keeps a credential-stuffing sweep out of the claim ceremony counter', async () => {
    const harness = createTestHarness()
    const remote = { ip: '203.0.113.78' }
    for (let n = 0; n < DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures; n += 1) {
      await expect(
        harness.devices.getCredentialBySecret(`guess-${String(n)}`, { remote }),
      ).resolves.toBeNull()
      harness.clock.advance(1000)
    }
    // M2's value is intact: the sweep's own path is locked.
    const claimed = await claimDevice(harness)
    await expect(
      harness.devices.getCredentialBySecret(claimed.ingest.secret, { remote }),
    ).resolves.toBeNull()
    expect(failuresFor(harness, lockoutSubjectFor('credential', remote.ip))).toBe(
      DEVICES_LOCKOUT_POLICY.perAccountOrIp.failures,
    )

    // ...and the claim ceremony from that same IP still answers on its own
    // terms — `not_found`, the documented answer for an id that does not
    // exist, not the sweep's `rate_limited`.
    expect(
      await codeOf(
        harness.devices.completeClaim({
          claimSessionId: 'invented-after-sweep',
          orgId: ORG,
          resource: VESSEL,
          installationId: 'inst-1',
          hardwareFingerprint: FINGERPRINT,
          userApprovalToken: 'whatever',
          approvedByUserId: 'owner-1',
          idempotencyKey: 'probe-b-1',
          remote,
        }),
      ),
    ).toBe('not_found')
  })

  /**
   * narduk-libs#228 third review MEDIUM-5. `AttributableRemoteContext` is
   * `RemoteContext & { ip: string }`, and `''` is a `string`, so
   * `{ remote: { ip: '' } }` type-checks and yields zero subjects — the exact
   * silent blind spot the type was added to make impossible. The README's own
   * recommended call is `remote: { ip: event.context.ip }`, and `getRequestIP`
   * returns `string | undefined`, so `?? ''` is one keystroke away.
   */
  it('refuses an attributed lookup that resolves to no subject at all', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    const requestIp: string | undefined = undefined
    const blind: CredentialSecretLookupOptions[] = [
      { remote: { ip: '' } },
      { remote: { accountKey: '' } },
      { remote: { accountKey: '', ip: '' } },
      // The idiom the README invites, spelled out.
      { remote: { ip: requestIp ?? '' } },
    ]
    for (const options of blind) {
      const error = await errorOf(
        harness.devices.getCredentialBySecret(claimed.ingest.secret, options),
      )
      expect(error.code, JSON.stringify(options)).toBe('invalid')
    }
    // Refused, not silently counted against nobody: no attempt row either.
    expect(failedAttempts(harness)).toBe(0)

    // A real subject, and an explicit opt-out, both still work.
    await expect(
      harness.devices.getCredentialBySecret(claimed.ingest.secret, {
        remote: { ip: '203.0.113.79' },
      }),
    ).resolves.not.toBeNull()
    await expect(
      harness.devices.getCredentialBySecret(claimed.ingest.secret, { unattributed: true }),
    ).resolves.not.toBeNull()
  })

  /**
   * `unattributed: true` means *count nothing*, and the union forbids passing
   * `remote` beside it — but a JavaScript consumer is not bound by the union,
   * and an explicit opt-out must never be silently overridden by a field the
   * type says cannot be there. This is what makes the `unattributed` branch in
   * `getCredentialBySecret` load-bearing rather than decorative
   * (narduk-libs#228 third review, test honesty).
   */
  it('counts nothing for an explicit unattributed lookup that also carries a remote', async () => {
    const harness = createTestHarness()
    await claimDevice(harness)
    const smuggled = {
      unattributed: true,
      remote: { ip: '203.0.113.80' },
    } as unknown as CredentialSecretLookupOptions
    await expect(
      harness.devices.getCredentialBySecret('no-such-secret', smuggled),
    ).resolves.toBeNull()
    expect(failedAttempts(harness)).toBe(0)
    expect(failuresFor(harness, lockoutSubjectFor('credential', '203.0.113.80'))).toBe(0)
  })

  it('keeps verifyCredentialSecret working for a caller that knows the id', async () => {
    const harness = createTestHarness()
    const claimed = await claimDevice(harness)
    await expect(
      harness.devices.verifyCredentialSecret({
        credentialId: claimed.ingest.credentialId,
        secret: claimed.ingest.secret,
      }),
    ).resolves.toMatchObject({ id: claimed.ingest.credentialId })
    await expect(
      harness.devices.verifyCredentialSecret({
        credentialId: claimed.ingest.credentialId,
        secret: claimed.command.secret,
      }),
    ).resolves.toBeNull()
  })
})
