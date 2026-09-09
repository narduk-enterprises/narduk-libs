import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import {
  createDevices,
  type CanonicalSessionRequest,
  type DevicesDatabase,
  type DevicesService,
  type DevicesServiceOptions,
} from '../../server/utils/devices'
import { base64UrlEncode, canonicalBytes } from '../../server/utils/devices-signing'

import type { CanonicalValue } from '../../server/utils/devices-signing'

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const MIGRATION_PATH = join(packageRoot, 'drizzle/0001_devices.sql')

export interface TestClock {
  advance: (milliseconds: number) => void
  now: () => number
  set: (milliseconds: number) => void
}

export function createTestClock(start = 1_700_000_000_000): TestClock {
  let current = start
  return {
    now: () => current,
    advance: (milliseconds) => {
      current += milliseconds
    },
    set: (milliseconds) => {
      current = milliseconds
    },
  }
}

export function createTestIdGenerator(prefix = 'id'): () => string {
  let counter = 0
  return () => {
    counter += 1
    return `${prefix}-${counter}`
  }
}

/** An Ed25519 device identity generated with Node's own crypto, never WebCrypto. */
export interface TestDeviceKey {
  privateKey: KeyObject
  /** Raw 32-byte public key, base64url. */
  publicKey: string
  sign: (request: CanonicalSessionRequest) => string
}

export function createDeviceKey(): TestDeviceKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' })
  const raw = Buffer.from(jwk.x ?? '', 'base64url')
  return {
    privateKey,
    publicKey: base64UrlEncode(new Uint8Array(raw)),
    sign: (request) =>
      base64UrlEncode(
        new Uint8Array(sign(null, canonicalBytes(request as unknown as CanonicalValue), privateKey)),
      ),
  }
}

export interface TestHarness {
  clock: TestClock
  db: DevicesDatabase
  devices: DevicesService
  sqlite: Database.Database
}

/**
 * Real SQLite, real DDL: the published migration file is executed verbatim
 * against an in-memory database, so nothing here can pass against a schema the
 * package does not ship.
 *
 * The one cast is the documented adapter the package README describes: the
 * service awaits `.get()`/`.all()`/`.run()`, and the synchronous better-sqlite3
 * driver returns values that `await` resolves unchanged, so the same code runs
 * on D1 (async) and here (sync).
 */
export function createTestHarness(
  options: { secrets?: string[]; tokens?: string[] } & Omit<
    DevicesServiceOptions,
    'now' | 'idGenerator' | 'tokenGenerator' | 'secretGenerator'
  > = {},
): TestHarness {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(readFileSync(MIGRATION_PATH, 'utf8'))

  const { secrets = [], tokens = [], ...serviceOptions } = options
  const clock = createTestClock()
  const nextId = createTestIdGenerator()
  const tokenQueue = [...tokens]
  const secretQueue = [...secrets]
  const nextToken = createTestIdGenerator('token-0123456789abcdef')
  const nextSecret = createTestIdGenerator('secret')

  const db = drizzle(sqlite) as unknown as DevicesDatabase
  const devices = createDevices(db, {
    ...serviceOptions,
    now: clock.now,
    idGenerator: nextId,
    tokenGenerator: () => tokenQueue.shift() ?? nextToken(),
    secretGenerator: () => secretQueue.shift() ?? nextSecret(),
  })

  return { sqlite, db, devices, clock }
}

export const ORG = 'org-1'
export const VESSEL = { kind: 'vessel', id: 'vessel-1' } as const
export const FINGERPRINT = 'sha256:fingerprint-1'
export const ALGORITHM = 'sha256-v1'

/** Mint a token and start a claim for a fresh device; returns everything a completion needs. */
export async function startPendingClaim(
  harness: TestHarness,
  overrides: { idempotencyKey?: string; key?: TestDeviceKey; remote?: { ip?: string } } = {},
) {
  const key = overrides.key ?? createDeviceKey()
  const minted = await harness.devices.createClaimToken({
    orgId: ORG,
    resource: VESSEL,
    createdByUserId: 'owner-1',
  })
  const started = await harness.devices.startClaim({
    claimToken: minted.token,
    hardwareFingerprint: FINGERPRINT,
    hardwareFingerprintAlgorithm: ALGORITHM,
    devicePublicKey: key.publicKey,
    softwareVersion: '1.0.0',
    idempotencyKey: overrides.idempotencyKey ?? `start-${minted.tokenId}`,
    ...(overrides.remote ? { remote: overrides.remote } : {}),
  })
  return { key, minted, started, claimSessionId: started.claimSessionId ?? '' }
}

/** Claim a device end to end: token → start → approve → complete. */
export async function claimDevice(harness: TestHarness, overrides: { key?: TestDeviceKey } = {}) {
  const pending = await startPendingClaim(harness, overrides)
  const approval = await harness.devices.issueApprovalToken({
    claimSessionId: pending.claimSessionId,
    orgId: ORG,
    resource: VESSEL,
    hardwareFingerprint: FINGERPRINT,
    approvedByUserId: 'owner-1',
  })
  const completed = await harness.devices.completeClaim({
    claimSessionId: pending.claimSessionId,
    orgId: ORG,
    resource: VESSEL,
    installationId: 'inst-1',
    hardwareFingerprint: FINGERPRINT,
    userApprovalToken: approval.token,
    approvedByUserId: 'owner-1',
    idempotencyKey: `complete-${pending.claimSessionId}`,
  })
  const ingest = completed.credentials.find((c) => c.credentialClass === 'ingest')
  const command = completed.credentials.find((c) => c.credentialClass === 'command')
  if (completed.status !== 'completed' || !completed.deviceId || !ingest || !command) {
    throw new Error(`claimDevice expected completion, got ${completed.status}`)
  }
  return { ...pending, approval, completed, deviceId: completed.deviceId, ingest, command }
}

/** A signed, well-formed session-open request for the given device and credential. */
export async function signedOpen(
  harness: TestHarness,
  claimed: Awaited<ReturnType<typeof claimDevice>>,
  credentialClass: 'ingest' | 'command',
  overrides: Partial<CanonicalSessionRequest> & { credentialId?: string; nonce?: string } = {},
) {
  const challenge = await harness.devices.issueChallenge({ deviceId: claimed.deviceId })
  const credential = credentialClass === 'ingest' ? claimed.ingest : claimed.command
  const request: CanonicalSessionRequest = {
    method: 'POST',
    route: '/api/edge/v1/session/open',
    resource: VESSEL,
    installationId: 'inst-1',
    deviceId: claimed.deviceId,
    credentialVersion: credential.version,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    timestamp: harness.clock.now(),
    requestHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    ...overrides,
  }
  return {
    challenge,
    request,
    input: {
      credentialClass,
      credentialId: overrides.credentialId ?? credential.credentialId,
      deviceId: claimed.deviceId,
      signature: claimed.key.sign(request),
      canonicalRequest: request,
    },
  }
}
