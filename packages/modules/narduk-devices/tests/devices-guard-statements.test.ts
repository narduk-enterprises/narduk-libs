/**
 * What one authenticated edge request costs, on the real D1 driver
 * (narduk-libs#225).
 *
 * `DeviceSession` carries the session's own facts but not the tenant's:
 * `orgId`, `resourceKind`/`resourceId` and `installationId` live on the device
 * row. A consumer answering "which tenant is this request for?" therefore
 * resolved the bearer and then re-read the device — two D1 round trips on the
 * hottest authenticated path the package has.
 *
 * These tests pin the statement count rather than a duration. Miniflare runs
 * on the test machine with no network hop and none of production's load, so
 * its timings mean nothing; the number of statements is the part that is real,
 * and it is what D1 bills and rate-limits.
 */
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createD1QueryHarness,
  expectQueryPlan,
  expectStatementBudget,
} from '../../../tooling/narduk-testkit/src/d1'
import { createDevices } from '../server/utils/devices'
import { requireDeviceSession } from '../server/utils/guards'

import {
  ALGORITHM,
  createDeviceKey,
  FINGERPRINT,
  MIGRATION_DIR,
  ORG,
  VESSEL,
} from './support/database'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import type { DevicesService } from '../server/utils/devices'
import type { H3Event } from 'h3'

function eventWith(authorization: string): H3Event {
  return { node: { req: { headers: { authorization } } } } as unknown as H3Event
}

describe('one authenticated request, on the real D1 driver', () => {
  let d1: D1QueryHarness
  let devices: DevicesService
  let deviceId: string
  let sessionToken: string

  beforeAll(async () => {
    d1 = await createD1QueryHarness({ migrations: MIGRATION_DIR })
    // The recording binding: every statement the service prepares is counted.
    devices = createDevices(drizzle(d1.db))

    const key = createDeviceKey()
    const minted = await devices.createClaimToken({
      orgId: ORG,
      resource: VESSEL,
      createdByUserId: 'owner-1',
    })
    const started = await devices.startClaim({
      claimToken: minted.token,
      devicePublicKey: key.publicKey,
      hardwareFingerprint: FINGERPRINT,
      hardwareFingerprintAlgorithm: ALGORITHM,
      idempotencyKey: 'statement-budget',
      softwareVersion: '1.0.0',
    })
    const claimSessionId = started.claimSessionId ?? ''
    const approval = await devices.issueApprovalToken({
      approvedByUserId: 'owner-1',
      claimSessionId,
      hardwareFingerprint: FINGERPRINT,
      orgId: ORG,
      resource: VESSEL,
    })
    const completed = await devices.completeClaim({
      approvedByUserId: 'owner-1',
      claimSessionId,
      hardwareFingerprint: FINGERPRINT,
      idempotencyKey: 'statement-budget-complete',
      installationId: 'inst-1',
      orgId: ORG,
      resource: VESSEL,
      userApprovalToken: approval.token,
    })
    deviceId = completed.deviceId ?? ''
    const ingest = completed.credentials.find((one) => one.credentialClass === 'ingest')
    const challenge = await devices.issueChallenge({ deviceId })
    const canonicalRequest = {
      challengeId: challenge.challengeId,
      credentialClass: 'ingest' as const,
      credentialId: ingest?.credentialId ?? '',
      credentialVersion: 1,
      deviceId,
      installationId: 'inst-1',
      method: 'POST',
      nonce: challenge.nonce,
      requestHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      resource: VESSEL,
      route: '/api/edge/v1/session/open',
      timestamp: Date.now(),
    }
    const opened = await devices.openSession({
      canonicalRequest,
      credentialClass: 'ingest',
      credentialId: ingest?.credentialId ?? '',
      deviceId,
      signature: key.sign(canonicalRequest),
    })
    sessionToken = opened.sessionToken
  })

  afterAll(async () => {
    await d1.dispose()
  })

  it('resolves the bearer and the tenant in one statement', async () => {
    const { result, statements } = await expectStatementBudget(
      d1,
      () => devices.getSessionByTokenWithDevice(sessionToken),
      { max: 1 },
    )

    expect(statements).toHaveLength(1)
    expect(result?.device.orgId).toBe(ORG)
    expect(result?.device.id).toBe(deviceId)
  })

  it('cost two the way a consumer had to do it (control: one is a real reduction)', async () => {
    const { statements } = await expectStatementBudget(
      d1,
      async () => {
        const session = await devices.getSessionByToken(sessionToken)
        return devices.getDevice(session?.deviceId ?? '')
      },
      { max: 2 },
    )

    // Exactly two, not "at most two": the budget above would also pass at one,
    // so the point of this test is the equality.
    expect(statements).toHaveLength(2)
  })

  it('costs one statement per request, not two (axis: requests)', async () => {
    for (const requests of [1, 2, 5]) {
      d1.reset()
      for (let k = 0; k < requests; k += 1) {
        const resolved = await devices.getSessionByTokenWithDevice(sessionToken)
        expect(resolved?.device.orgId).toBe(ORG)
      }
      expect(d1.statements).toHaveLength(requests)
    }
  })

  it('reaches both rows by index, so the one statement stays one as the tables grow', async () => {
    d1.reset()
    await devices.getSessionByTokenWithDevice(sessionToken)
    const sql = d1.statements.at(0) ?? ''
    expect(sql).toMatch(/join/iu)

    // One placeholder per `?` the statement carries: the digest, and drizzle's
    // own `limit`.
    const params = Array.from({ length: (sql.match(/\?/gu) ?? []).length }, (_, index) =>
      index === 0 ? 'no-such-digest' : 1,
    )
    const plan = await expectQueryPlan(d1, sql, params, {
      forbidFullScanOf: ['devices_sessions', 'devices_devices'],
    })
    // The session is found by its unique token digest, and the device by its
    // primary key. Neither side is a scan, so neither side grows with the
    // number of devices or sessions the org has accumulated.
    expect(plan.join('\n')).toMatch(/SEARCH devices_sessions USING (?:COVERING )?INDEX/u)
    expect(plan.join('\n')).toMatch(
      /SEARCH devices_devices USING (?:INTEGER PRIMARY KEY|(?:COVERING )?INDEX)/u,
    )
  })

  it('the guard itself costs one statement, end to end', async () => {
    const { result, statements } = await expectStatementBudget(
      d1,
      () =>
        requireDeviceSession(eventWith(`Bearer ${sessionToken}`), {
          credentialClass: 'ingest',
          devices,
        }),
      { max: 1 },
    )

    expect(statements).toHaveLength(1)
    // Everything a route needs to authorize the request, from one read.
    expect(result.device).toMatchObject({
      id: deviceId,
      installationId: 'inst-1',
      orgId: ORG,
      resourceId: VESSEL.id,
      resourceKind: VESSEL.kind,
    })
  })
})
