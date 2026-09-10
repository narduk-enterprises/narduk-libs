import { readFileSync } from 'node:fs'

import { drizzle } from 'drizzle-orm/d1'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDevices } from '../server/utils/devices'

import {
  ALGORITHM,
  createDeviceKey,
  FINGERPRINT,
  MIGRATION_PATH,
  ORG,
  VESSEL,
} from './support/database'

describe('D1 integration', () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("devices test"); } }',
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
  })
  let binding: Awaited<ReturnType<Miniflare['getD1Database']>>

  beforeAll(async () => {
    binding = await runtime.getD1Database('DB')
    const statements = readFileSync(MIGRATION_PATH, 'utf8')
      .replaceAll(/--[^\n]*/g, '')
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean)
    await binding.batch(statements.map((statement) => binding.prepare(statement)))
  })

  afterAll(async () => {
    await runtime.dispose()
  })

  it('claims a device atomically and opens a signed session on the real D1 driver', async () => {
    const devices = createDevices(drizzle(binding))
    const key = createDeviceKey()
    const minted = await devices.createClaimToken({
      orgId: ORG,
      resource: VESSEL,
      createdByUserId: 'owner-1',
    })
    const started = await devices.startClaim({
      claimToken: minted.token,
      hardwareFingerprint: FINGERPRINT,
      hardwareFingerprintAlgorithm: ALGORITHM,
      devicePublicKey: key.publicKey,
      softwareVersion: '1.0.0',
      idempotencyKey: 'd1-start',
    })
    expect(started.status).toBe('pending_user_approval')
    const claimSessionId = started.claimSessionId ?? ''
    const approval = await devices.issueApprovalToken({
      claimSessionId,
      orgId: ORG,
      resource: VESSEL,
      hardwareFingerprint: FINGERPRINT,
      approvedByUserId: 'owner-1',
    })
    const complete = (idempotencyKey: string) =>
      devices.completeClaim({
        claimSessionId,
        orgId: ORG,
        resource: VESSEL,
        installationId: 'inst-1',
        hardwareFingerprint: FINGERPRINT,
        userApprovalToken: approval.token,
        approvedByUserId: 'owner-1',
        idempotencyKey,
      })
    const results = await Promise.all([complete('a'), complete('b')])
    expect(results.map((result) => result.status).sort()).toEqual([
      'already_completed',
      'completed',
    ])
    const completed = results.find((result) => result.status === 'completed')
    const command = completed?.credentials.find((c) => c.credentialClass === 'command')
    expect(command).toBeDefined()
    const deviceId = completed?.deviceId ?? ''

    const challenge = await devices.issueChallenge({ deviceId })
    const request = {
      method: 'POST',
      route: '/api/edge/v1/session/open',
      resource: VESSEL,
      installationId: 'inst-1',
      deviceId,
      credentialClass: 'command' as const,
      credentialId: command?.credentialId ?? '',
      credentialVersion: 1,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      timestamp: Date.now(),
      requestHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    }
    const input = {
      credentialClass: 'command' as const,
      credentialId: command?.credentialId ?? '',
      deviceId,
      signature: key.sign(request),
      canonicalRequest: request,
    }
    const opened = await devices.openSession(input)
    expect(opened.revocationGeneration).toBe(0)
    expect(opened.sessionToken).not.toBe(opened.sessionId)
    // The bearer resolves by digest on the real D1 driver too.
    expect(await devices.getSessionByToken(opened.sessionToken)).toMatchObject({
      id: opened.sessionId,
    })
    expect(await devices.getSessionByToken(opened.sessionId)).toBeNull()
    await expect(devices.openSession(input)).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(
      devices.openSession({ ...input, credentialClass: 'ingest' }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    // A signed body re-aimed at the other credential is refused by the binding.
    const ingest = completed?.credentials.find((c) => c.credentialClass === 'ingest')
    await expect(
      devices.openSession({
        ...input,
        credentialClass: 'ingest',
        credentialId: ingest?.credentialId ?? '',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' })
  }, 30_000)
})
