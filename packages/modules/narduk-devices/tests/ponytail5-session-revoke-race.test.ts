import { describe, expect, it } from 'vitest'

import { verifyEd25519 } from '../server/utils/devices-signing'

import { claimDevice, createTestHarness, signedOpen } from './support/database'

import type { SignatureVerifier } from '../server/utils/devices-signing'

/**
 * Ponytail-5 repro for #2003 analytics-seo-devices #1: a revoke or rotation
 * that commits while openSession awaits the signature check must not leave a
 * live session through any getter. Red before the fix.
 */
function racingHarness() {
  let duringVerify: (() => Promise<unknown>) | null = null
  const verifier: SignatureVerifier = async (args) => {
    const sneak = duringVerify
    duringVerify = null
    if (sneak) await sneak()
    return verifyEd25519(args)
  }
  const harness = createTestHarness({ verifySignature: verifier })
  return {
    harness,
    race: (fn: () => Promise<unknown>) => {
      duringVerify = fn
    },
  }
}

async function openOrNull(open: () => Promise<{ sessionId: string; sessionToken: string }>) {
  try {
    return await open()
  } catch {
    return null // Refusing the open is the correct outcome.
  }
}

async function liveness(
  devices: ReturnType<typeof createTestHarness>['devices'],
  opened: { sessionId: string; sessionToken: string },
) {
  return {
    getSession: (await devices.getSession(opened.sessionId)) !== null,
    getSessionByToken: (await devices.getSessionByToken(opened.sessionToken)) !== null,
    withDevice: (await devices.getSessionByTokenWithDevice(opened.sessionToken)) !== null,
  }
}

const ALL_LIVE = { getSession: true, getSessionByToken: true, withDevice: true }

describe('openSession vs a concurrent revoke', () => {
  it('does not hand out a live bearer when revokeDevice lands during verification', async () => {
    const { harness, race } = racingHarness()
    const { devices } = harness
    const claimed = await claimDevice(harness)
    const { input } = await signedOpen(harness, claimed, 'command')

    race(() => devices.revokeDevice({ deviceId: claimed.deviceId }))
    const opened = await openOrNull(() => devices.openSession(input))

    expect((await devices.getDevice(claimed.deviceId))?.status).toBe('revoked')
    expect(opened).toBeNull()
  })

  it('does not hand out a live bearer when its class is rotated during verification', async () => {
    const { harness, race } = racingHarness()
    const { devices } = harness
    const claimed = await claimDevice(harness)
    const { input } = await signedOpen(harness, claimed, 'command')

    race(() => devices.rotateCredential({ deviceId: claimed.deviceId, credentialClass: 'command' }))
    const opened = await openOrNull(() => devices.openSession(input))

    expect(opened).toBeNull()
  })

  it('keeps the other class live through every getter after a rotation', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const claimed = await claimDevice(harness)
    const ingest = await devices.openSession((await signedOpen(harness, claimed, 'ingest')).input)

    await devices.rotateCredential({ deviceId: claimed.deviceId, credentialClass: 'command' })

    expect(await liveness(devices, ingest)).toEqual(ALL_LIVE)
  })
})
