import { sign } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createDevices } from '../server/utils/devices'
import {
  type ContextBoundCompletionProof,
  contextBoundSigningBytes,
  parseContextBoundRequest,
  timingSafeEqualText,
} from '../server/utils/devices-context-proof'
import { base64UrlEncode, canonicalJson, toHex } from '../server/utils/devices-signing'

import {
  createTestHarness,
  FINGERPRINT,
  ORG,
  startPendingClaim,
  type TestDeviceKey,
  type TestHarness,
  VESSEL,
} from './support/database'

import type { CompleteClaimWithRecordedApprovalInput } from '../server/utils/devices'

/** mybo.at's handoff context (`CLAIM_HANDOFF_SIGNING_CONTEXT` in `@mybo/contracts`). */
const HANDOFF_CONTEXT = 'mybo/claim-handoff/v1'
const HANDOFF_KEY = 'handoff-1'

/**
 * mybo-at-v2 `packages/contracts/vectors/canonical-vectors.json`, `signingBytes`
 * row "claim handoff, the shipped fixture value": the exact bytes its edge
 * appliance signs. Pinned here so the library verifies mybo's layout, not a
 * look-alike of it.
 */
const MYBO_VECTOR = {
  context: HANDOFF_CONTEXT,
  input:
    '{"claimSessionId":"clm_01K6ZC0FIXTUREONLY0001","devicePublicKey":"N2qol9j_ZEgcNwlfsJnAveSnpBwVUA2fhRrWL0175xs","hardwareFingerprint":"fp_9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e","idempotencyKey":"idem_22d775b7c7dcad53a9a18d5040a0d53d","nonce":"FoxPMeNfS81C7BU8cr2uEQ","signedAt":1788000600000}',
  utf8Hex:
    '6d79626f2f636c61696d2d68616e646f66662f76310a7b22636c61696d53657373696f6e4964223a22636c6d5f30314b365a4330464958545552454f4e4c5930303031222c226465766963655075626c69634b6579223a224e32716f6c396a5f5a4567634e776c66734a6e417665536e7042775655413266685272574c303137357873222c22686172647761726546696e6765727072696e74223a2266705f3965396539653965396539653965396539653965396539653965396539653965222c226964656d706f74656e63794b6579223a226964656d5f3232643737356237633764636164353361396131386435303430613064353364222c226e6f6e6365223a22466f78504d654e665338314337425538637232754551222c227369676e65644174223a313738383030303630303030307d',
}

let nonceCounter = 0

interface HandoffOptions {
  canonicalRequest?: string
  context?: string
  idempotencyKey?: string
  nonce?: string
  signedAt?: number
  signWith?: TestDeviceKey
}

/** What mybo's appliance sends: a handoff body signed under its own context. */
function handoffProof(
  harness: TestHarness,
  claim: { claimSessionId: string; key: TestDeviceKey },
  options: HandoffOptions = {},
): ContextBoundCompletionProof {
  nonceCounter += 1
  const context = options.context ?? HANDOFF_CONTEXT
  const canonicalRequest =
    options.canonicalRequest ??
    canonicalJson({
      claimSessionId: claim.claimSessionId,
      devicePublicKey: claim.key.publicKey,
      hardwareFingerprint: FINGERPRINT,
      idempotencyKey: options.idempotencyKey ?? HANDOFF_KEY,
      nonce: options.nonce ?? `handoff-nonce-${nonceCounter}`,
      signedAt: options.signedAt ?? harness.clock.now(),
    })
  const signer = options.signWith ?? claim.key
  const signature = base64UrlEncode(
    new Uint8Array(
      sign(null, contextBoundSigningBytes(context, canonicalRequest), signer.privateKey),
    ),
  )
  return { context, canonicalRequest, signature }
}

type Claim = Awaited<ReturnType<typeof startPendingClaim>>

/** The route's call: every installation id is freshly minted, never signed. */
function completion(
  claim: { claimSessionId: string; key: TestDeviceKey },
  deviceProof: ContextBoundCompletionProof,
): CompleteClaimWithRecordedApprovalInput {
  return {
    claimSessionId: claim.claimSessionId,
    devicePublicKey: claim.key.publicKey,
    hardwareFingerprint: FINGERPRINT,
    idempotencyKey: HANDOFF_KEY,
    installationId: globalThis.crypto.randomUUID(),
    deviceProof,
    reissueOnIdempotentReplay: true,
  }
}

async function completedClaim(harness: TestHarness) {
  const pending = await startPendingClaim(harness)
  await harness.devices.issueApprovalToken({
    claimSessionId: pending.claimSessionId,
    orgId: ORG,
    resource: VESSEL,
    hardwareFingerprint: FINGERPRINT,
    approvedByUserId: 'owner-1',
  })
  const first = await harness.devices.completeClaimWithRecordedApproval(
    completion(pending, handoffProof(harness, pending)),
  )
  expect(first.status).toBe('completed')
  return { ...pending, first }
}

const REFUSED = { status: 'already_completed', credentials: [] }

describe('the consumer-shaped completion proof (narduk-libs#237)', () => {
  it('produces mybo.at’s claim-handoff/v1 bytes exactly', () => {
    expect(parseContextBoundRequest(MYBO_VECTOR.input)).not.toBeNull()
    expect(toHex(contextBoundSigningBytes(MYBO_VECTOR.context, MYBO_VECTOR.input))).toBe(
      MYBO_VECTOR.utf8Hex,
    )
  })

  it('re-issues a lost completion to a device that signed its own handoff body', async () => {
    const harness = createTestHarness({ completionProofContext: HANDOFF_CONTEXT })
    const claim = await completedClaim(harness)

    const replay = await harness.devices.completeClaimWithRecordedApproval(
      completion(claim, handoffProof(harness, claim)),
    )
    expect(replay.status).toBe('completed')
    expect(replay.credentials).toHaveLength(2)
    // The replay's own installation id was minted fresh and never recorded;
    // the result names the one the device row holds, for the route to return.
    const [device] = claim.first.deviceId
      ? [await harness.devices.getDevice(claim.first.deviceId)]
      : []
    expect(device?.installationId).toBeDefined()
    expect(replay.installationId).toBe(device?.installationId)
    for (const credential of replay.credentials) {
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.not.toBeNull()
    }
    // The superseded set is revoked, exactly as on the library's own proof.
    for (const credential of claim.first.credentials) {
      await expect(
        harness.devices.getCredentialBySecret(credential.secret, { unattributed: true }),
      ).resolves.toBeNull()
    }
  })

  it('refuses a proof signed under a different context', async () => {
    const harness = createTestHarness({ completionProofContext: HANDOFF_CONTEXT })
    const claim = await completedClaim(harness)
    // A genuine signature by the device key, made for another protocol that
    // shares the key: exactly what the domain separator exists to stop.
    const receipt = handoffProof(harness, claim, { context: 'mybo/command-receipt/v1' })
    expect(
      await harness.devices.completeClaimWithRecordedApproval(completion(claim, receipt)),
    ).toEqual(REFUSED)
    // Claiming the expected context over bytes signed under another fails too.
    expect(
      await harness.devices.completeClaimWithRecordedApproval(
        completion(claim, { ...receipt, context: HANDOFF_CONTEXT }),
      ),
    ).toEqual(REFUSED)
  })

  // One claim per case: each refusal counts against the claim lockout, which
  // would otherwise answer rate_limited from the sixth case on.
  it.each<
    [
      string,
      (
        genuine: ContextBoundCompletionProof,
        h: TestHarness,
        c: Claim,
      ) => ContextBoundCompletionProof,
    ]
  >([
    [
      'a value changed after signing',
      (genuine) => ({
        ...genuine,
        canonicalRequest: genuine.canonicalRequest.replace(HANDOFF_KEY, 'handoff-2'),
      }),
    ],
    [
      'the same value, not in canonical form',
      (genuine) => ({
        ...genuine,
        canonicalRequest: JSON.stringify(JSON.parse(genuine.canonicalRequest), null, 1),
      }),
    ],
    [
      'an extra, unsigned key',
      (genuine) => ({
        ...genuine,
        canonicalRequest: genuine.canonicalRequest.replace(/\}$/u, ',"zz":1}'),
      }),
    ],
    [
      'a duplicated key JSON.parse would collapse',
      (genuine) => ({
        ...genuine,
        canonicalRequest: genuine.canonicalRequest.replace('{', '{"claimSessionId":"other",'),
      }),
    ],
    ['not JSON at all', (genuine) => ({ ...genuine, canonicalRequest: 'not json' })],
    [
      'an honest signature over another idempotency key',
      (_genuine, h, c) => handoffProof(h, c, { idempotencyKey: 'handoff-2' }),
    ],
    [
      'a signedAt outside the skew window',
      (_genuine, h, c) => handoffProof(h, c, { signedAt: h.clock.now() - 301_000 }),
    ],
  ])('refuses a tampered canonicalRequest: %s', async (_label, tamper) => {
    const harness = createTestHarness({ completionProofContext: HANDOFF_CONTEXT })
    const claim = await completedClaim(harness)
    const deviceProof = tamper(handoffProof(harness, claim), harness, claim)
    expect(
      await harness.devices.completeClaimWithRecordedApproval(completion(claim, deviceProof)),
    ).toEqual(REFUSED)
  })

  it('refuses a bad signature', async () => {
    const harness = createTestHarness({ completionProofContext: HANDOFF_CONTEXT })
    const claim = await completedClaim(harness)
    const genuine = handoffProof(harness, claim)
    const otherKey = (await startPendingClaim(harness)).key
    const flipped = genuine.signature.startsWith('A')
      ? `B${genuine.signature.slice(1)}`
      : `A${genuine.signature.slice(1)}`
    for (const deviceProof of [
      handoffProof(harness, claim, { signWith: otherKey }),
      { ...genuine, signature: flipped },
      { ...genuine, signature: '' },
      { ...genuine, signature: 'not base64url!' },
    ]) {
      expect(
        await harness.devices.completeClaimWithRecordedApproval(completion(claim, deviceProof)),
      ).toEqual(REFUSED)
    }
  })

  it('refuses a captured proof replayed a second time', async () => {
    const harness = createTestHarness({ completionProofContext: HANDOFF_CONTEXT })
    const claim = await completedClaim(harness)
    const captured = completion(claim, handoffProof(harness, claim))
    expect((await harness.devices.completeClaimWithRecordedApproval(captured)).status).toBe(
      'completed',
    )
    expect(await harness.devices.completeClaimWithRecordedApproval(captured)).toEqual(REFUSED)
  })

  it('refuses the first completion’s own proof as a re-issue proof', async () => {
    const harness = createTestHarness({ completionProofContext: HANDOFF_CONTEXT })
    const pending = await startPendingClaim(harness)
    await harness.devices.issueApprovalToken({
      claimSessionId: pending.claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
    })
    const firstProof = handoffProof(harness, pending)
    const first = await harness.devices.completeClaimWithRecordedApproval(
      completion(pending, firstProof),
    )
    expect(first.status).toBe('completed')
    expect(
      await harness.devices.completeClaimWithRecordedApproval(completion(pending, firstProof)),
    ).toEqual(REFUSED)
  })

  it('fails closed when the service was not told which context to accept', async () => {
    const harness = createTestHarness()
    const claim = await startPendingClaim(harness)
    await expect(
      harness.devices.completeClaimWithRecordedApproval(
        completion(claim, handoffProof(harness, claim)),
      ),
    ).rejects.toMatchObject({ code: 'invalid' })
  })

  it('refuses a malformed or package-owned context at construction', () => {
    const db = createTestHarness().db
    for (const completionProofContext of [
      '',
      'mybo/claim-handoff',
      'Mybo/claim-handoff/v1',
      'mybo claim/v1',
      'narduk-devices/claim-completion/v1',
    ]) {
      expect(() => createDevices(db, { completionProofContext })).toThrow(
        expect.objectContaining({ code: 'invalid' }),
      )
    }
  })

  it('compares text in constant time over fixed-width digests', async () => {
    expect(await timingSafeEqualText('abc', 'abc')).toBe(true)
    expect(await timingSafeEqualText('abc', 'abd')).toBe(false)
    expect(await timingSafeEqualText('abc', 'abcd')).toBe(false)
  })
})
