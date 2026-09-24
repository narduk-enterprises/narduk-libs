import { describe, expect, it, vi } from 'vitest'

import {
  DEVICES_DENIED_ERROR_CODE,
  DEVICES_UNAUTHORIZED_ERROR_CODE,
  type DeviceSessionResolver,
  readBearerSessionToken,
  requireDeviceSession,
} from '../server/utils/guards'

import { claimDevice, createTestHarness, signedOpen } from './support/database'

import type { H3Event } from 'h3'

interface ThrownH3Error {
  data?: { errorCode?: string }
  statusCode: number
}

function eventWith(authorization?: string): H3Event {
  return {
    node: { req: { headers: authorization === undefined ? {} : { authorization } } },
  } as unknown as H3Event
}

async function thrown(promise: Promise<unknown>): Promise<ThrownH3Error> {
  try {
    await promise
    throw new Error('expected the guard to reject')
  } catch (error) {
    return error as ThrownH3Error
  }
}

describe('readBearerSessionToken', () => {
  it('reads only a well-formed bearer header', () => {
    expect(readBearerSessionToken(eventWith('Bearer abc'))).toBe('abc')
    expect(readBearerSessionToken(eventWith('bearer  abc '))).toBe('abc')
    expect(readBearerSessionToken(eventWith('Basic abc'))).toBeNull()
    expect(readBearerSessionToken(eventWith('Bearer'))).toBeNull()
    expect(readBearerSessionToken(eventWith('Bearer a b'))).toBeNull()
    expect(readBearerSessionToken(eventWith())).toBeNull()
  })
})

describe('requireDeviceSession', () => {
  it('401s a request without a bearer session before consulting the service', async () => {
    const devices: DeviceSessionResolver = { getSessionByTokenWithDevice: vi.fn() }
    const error = await thrown(
      requireDeviceSession(eventWith(), { devices, credentialClass: 'ingest' }),
    )
    expect(error.statusCode).toBe(401)
    expect(error.data?.errorCode).toBe(DEVICES_UNAUTHORIZED_ERROR_CODE)
    expect(devices.getSessionByTokenWithDevice).not.toHaveBeenCalled()
  })

  it('never admits the session row id as a bearer', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const claimed = await claimDevice(harness)
    const opened = await devices.openSession((await signedOpen(harness, claimed, 'ingest')).input)
    expect(opened.sessionToken).not.toBe(opened.sessionId)
    expect(
      (
        await thrown(
          requireDeviceSession(eventWith(`Bearer ${opened.sessionId}`), {
            devices,
            credentialClass: 'ingest',
          }),
        )
      ).statusCode,
    ).toBe(401)
  })

  it('401s an unknown, expired or revoked session', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const claimed = await claimDevice(harness)
    const opened = await devices.openSession((await signedOpen(harness, claimed, 'ingest')).input)

    expect(
      (
        await thrown(
          requireDeviceSession(eventWith('Bearer ghost'), { devices, credentialClass: 'ingest' }),
        )
      ).statusCode,
    ).toBe(401)
    await devices.revokeSession({ sessionToken: opened.sessionToken })
    expect(
      (
        await thrown(
          requireDeviceSession(eventWith(`Bearer ${opened.sessionToken}`), {
            devices,
            credentialClass: 'ingest',
          }),
        )
      ).statusCode,
    ).toBe(401)
  })

  it('passes a session of the required class and 403s the other class', async () => {
    const harness = createTestHarness()
    const { devices } = harness
    const claimed = await claimDevice(harness)
    const ingest = await devices.openSession((await signedOpen(harness, claimed, 'ingest')).input)

    await expect(
      requireDeviceSession(eventWith(`Bearer ${ingest.sessionToken}`), {
        devices,
        credentialClass: 'ingest',
      }),
    ).resolves.toMatchObject({ credentialClass: 'ingest', id: ingest.sessionId })

    // The tenant arrives with the session, and it is the device row itself:
    // this is exactly what a route used to re-read to learn which org it was
    // serving (narduk-libs#225).
    const resolved = await requireDeviceSession(eventWith(`Bearer ${ingest.sessionToken}`), {
      devices,
      credentialClass: 'ingest',
    })
    expect(resolved.device).toEqual(await devices.getDevice(claimed.deviceId))
    expect(resolved.device.id).toBe(claimed.deviceId)

    const denied = await thrown(
      requireDeviceSession(eventWith(`Bearer ${ingest.sessionToken}`), {
        devices,
        credentialClass: 'command',
      }),
    )
    expect(denied.statusCode).toBe(403)
    expect(denied.data?.errorCode).toBe(DEVICES_DENIED_ERROR_CODE)

    // A custom resolver replaces the header read.
    await expect(
      requireDeviceSession(eventWith(), {
        devices,
        credentialClass: 'ingest',
        resolveSessionToken: () => ingest.sessionToken,
      }),
    ).resolves.toMatchObject({ id: ingest.sessionId })
  })
})
