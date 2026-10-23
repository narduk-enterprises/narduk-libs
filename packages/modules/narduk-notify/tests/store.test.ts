import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createD1QueryHarness, expectQueryPlan } from '../../../tooling/narduk-testkit/src/d1'
import { createApnsClient } from '../src/apns'
import { hashTarget, listDeliveries, pruneDeliveries, recordDeliveries } from '../src/audit'
import { NotifyError } from '../src/errors'
import { createNotifier } from '../src/notifier'
import { createNotifyPreferences } from '../src/preferences'

import { ACTIVITY_TOKEN, DEVICE_TOKEN, generateTestApnsKey } from './support/keys'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import type { ApnsRequest, ApnsTransportResponse } from '../src/apns'
import type { DeliveryRecord } from '../src/audit'
import type { NotifyD1Database } from '../src/d1'
import type { ResendClient } from '../src/email'
import type { NotifyCategories } from '../src/preferences'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const CATEGORIES: NotifyCategories = {
  'anchor-alarm': { defaults: { push: true, email: true }, mandatory: ['push'] },
  'shore-power': { defaults: { push: true, email: false } },
  'morning-message': { defaults: { push: false, email: true } },
}

let d1: D1QueryHarness
let db: NotifyD1Database

beforeAll(async () => {
  d1 = await createD1QueryHarness({ migrations: MIGRATIONS })
  db = d1.db as unknown as NotifyD1Database
})

afterAll(async () => {
  await d1.dispose()
})

beforeEach(async () => {
  await d1.clearData()
  d1.reset()
})

describe('preferences', () => {
  it('resolves defaults, user overrides and mandatory channels in one query', async () => {
    const preferences = createNotifyPreferences({ db, categories: CATEGORIES, now: () => 1000 })
    await preferences.set({
      userId: 'u1',
      category: 'shore-power',
      channel: 'email',
      enabled: true,
    })
    await preferences.set({
      userId: 'u1',
      category: 'morning-message',
      channel: 'email',
      enabled: false,
    })
    await preferences.set({
      userId: 'u1',
      category: 'morning-message',
      channel: 'email',
      enabled: true,
    })
    await preferences.set({
      userId: 'u1',
      category: 'morning-message',
      channel: 'email',
      enabled: false,
    })
    await preferences.set({
      userId: 'u2',
      category: 'shore-power',
      channel: 'push',
      enabled: false,
    })

    d1.reset()
    const resolved = await preferences.get('u1')
    expect(d1.statements).toHaveLength(1)
    expect(resolved).toEqual({
      'anchor-alarm': {
        push: { enabled: true, source: 'mandatory' },
        email: { enabled: true, source: 'default' },
      },
      'shore-power': {
        push: { enabled: true, source: 'default' },
        email: { enabled: true, source: 'user' },
      },
      'morning-message': {
        push: { enabled: false, source: 'default' },
        email: { enabled: false, source: 'user' },
      },
    })
    expect((await preferences.get('u2'))['shore-power']?.push).toEqual({
      enabled: false,
      source: 'user',
    })
  })

  it('refuses unknown categories and turning off a mandatory channel', async () => {
    const preferences = createNotifyPreferences({ db, categories: CATEGORIES })
    const codeOf = (promise: Promise<unknown>) =>
      promise.then(
        () => 'none',
        (error: unknown) => (error as NotifyError).code,
      )
    expect(
      await codeOf(
        preferences.set({ userId: 'u', category: 'nope', channel: 'push', enabled: true }),
      ),
    ).toBe('unknown_category')
    expect(
      await codeOf(
        preferences.set({ userId: 'u', category: 'toString', channel: 'push', enabled: true }),
      ),
    ).toBe('unknown_category')
    expect(
      await codeOf(
        preferences.set({
          userId: 'u',
          category: 'anchor-alarm',
          channel: 'sms' as never,
          enabled: true,
        }),
      ),
    ).toBe('unknown_channel')
    expect(
      await codeOf(
        preferences.set({ userId: 'u', category: 'anchor-alarm', channel: 'push', enabled: false }),
      ),
    ).toBe('mandatory_channel')
    await preferences.set({
      userId: 'u',
      category: 'anchor-alarm',
      channel: 'email',
      enabled: false,
    })
  })
})

function record(overrides: Partial<DeliveryRecord>): DeliveryRecord {
  return {
    id: crypto.randomUUID(),
    createdAt: 1000,
    userId: 'u1',
    category: 'shore-power',
    channel: 'push',
    pushType: 'alert',
    environment: 'production',
    targetRef: 'ref',
    status: 'sent',
    providerId: 'apns-1',
    statusCode: 200,
    reason: null,
    tokenInvalid: false,
    ...overrides,
  }
}

describe('delivery audit', () => {
  it('writes a fan-out in one batch and reads it back newest first, paged', async () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      record({ createdAt: 1000 + index, id: `d${index}` }),
    )
    rows.push(record({ id: 'other', userId: 'u2' }))
    rows.push(
      record({
        id: 'email',
        channel: 'email',
        pushType: null,
        environment: null,
        status: 'failed',
        statusCode: 422,
        reason: 'validation_error',
        providerId: null,
        createdAt: 2000,
      }),
    )
    d1.reset()
    await recordDeliveries(db, rows)
    expect(d1.statements).toHaveLength(rows.length)
    await recordDeliveries(db, [])

    const page = await listDeliveries(db, { userId: 'u1', limit: 3 })
    expect(page.map((row) => row.id)).toEqual(['email', 'd4', 'd3'])
    expect(page[0]).toEqual(rows.at(-1))
    const next = await listDeliveries(db, { userId: 'u1', before: page.at(-1) })
    expect(next.map((row) => row.id)).toEqual(['d2', 'd1', 'd0'])
  })

  it('pages through rows of one event that share a timestamp without skipping any', async () => {
    // One notifier event writes every row with the same createdAt.
    const tied = ['a', 'b', 'c', 'd', 'e'].map((id) => record({ id, createdAt: 3000 }))
    await recordDeliveries(db, [...tied, record({ id: 'z', createdAt: 1000 })])
    const seen: string[] = []
    let before: DeliveryRecord | undefined
    for (;;) {
      const page = await listDeliveries(db, {
        userId: 'u1',
        limit: 2,
        ...(before ? { before } : {}),
      })
      if (page.length === 0) break
      seen.push(...page.map((row) => row.id))
      before = page.at(-1)
    }
    expect(seen).toEqual(['e', 'd', 'c', 'b', 'a', 'z'])
  })

  it('reads by the user index, not a table scan', async () => {
    const plan = await expectQueryPlan(
      d1,
      'SELECT * FROM notify_deliveries WHERE user_id = ?1 AND created_at < ?2 ORDER BY created_at DESC, id DESC LIMIT ?3',
      ['u1', 5000, 10],
      { forbidFullScanOf: ['notify_deliveries'] },
    )
    expect(plan.join('\n')).toMatch(/notify_deliveries_user_created/u)
  })

  it('prunes old rows in bounded chunks', async () => {
    await recordDeliveries(
      db,
      Array.from({ length: 7 }, (_, index) => record({ id: `p${index}`, createdAt: index })),
    )
    expect(await pruneDeliveries(db, { olderThan: 5, limit: 3 })).toBe(3)
    expect(await pruneDeliveries(db, { olderThan: 5, limit: 3 })).toBe(2)
    expect(await pruneDeliveries(db, { olderThan: 5, limit: 3 })).toBe(0)
    expect((await listDeliveries(db, { userId: 'u1' })).map((row) => row.id)).toEqual(['p6', 'p5'])
  })

  it('hashes targets case-insensitively and never stores the raw value', async () => {
    expect(await hashTarget(' Logan@Example.com ')).toBe(await hashTarget('logan@example.com'))
    expect(await hashTarget(DEVICE_TOKEN)).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('refuses a row the schema does not allow', async () => {
    await expect(recordDeliveries(db, [record({ status: 'lost' as never })])).rejects.toThrow()
  })
})

describe('notifier', () => {
  async function setup(options: { emailFails?: boolean; withEmail?: boolean } = {}) {
    const key = await generateTestApnsKey()
    const pushes: ApnsRequest[] = []
    const emails: unknown[] = []
    const apns = createApnsClient({
      bundleId: 'at.mybo.app',
      environment: 'production',
      credentials: { teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: key.p8 },
      transport: async (request): Promise<ApnsTransportResponse> => {
        pushes.push(request)
        if (request.url.endsWith(ACTIVITY_TOKEN)) {
          return { status: 410, headers: {}, body: '{"reason":"Unregistered"}' }
        }
        return { status: 200, headers: { 'apns-id': request.headers['apns-id'] ?? '' }, body: '' }
      },
    })
    const client: ResendClient = {
      send: async (message) => {
        emails.push(message)
        return options.emailFails
          ? { ok: false, status: 422, id: null, reason: 'validation_error', retryable: false }
          : { ok: true, status: 200, id: 'email-1', reason: null, retryable: false }
      },
    }
    let id = 0
    const notifier = createNotifier({
      db,
      categories: CATEGORIES,
      apns,
      ...(options.withEmail === false
        ? {}
        : { email: { client, from: 'MyBoat <alerts@mybo.at>' } }),
      now: () => 5000,
      newId: () => `n${(id += 1)}`,
    })
    return { notifier, pushes, emails }
  }

  const alert = { pushType: 'alert', alert: { title: 'Anchor alarm', body: 'Dragging' } } as const

  it('sends every allowed target in parallel, audits each, and flags dead tokens', async () => {
    const { notifier, pushes, emails } = await setup()
    const result = await notifier.send({
      userId: 'u1',
      category: 'anchor-alarm',
      push: {
        notification: alert,
        targets: [
          { deviceToken: DEVICE_TOKEN },
          { deviceToken: ACTIVITY_TOKEN, environment: 'development' },
        ],
      },
      email: { to: 'logan@example.com', subject: 'Anchor alarm', text: 'Dragging' },
    })
    expect(result.auditError).toBeNull()
    expect(pushes).toHaveLength(2)
    expect(emails).toEqual([
      {
        to: 'logan@example.com',
        subject: 'Anchor alarm',
        text: 'Dragging',
        from: 'MyBoat <alerts@mybo.at>',
      },
    ])
    expect(
      result.deliveries.map(({ channel, status, statusCode, tokenInvalid, environment }) => ({
        channel,
        status,
        statusCode,
        tokenInvalid,
        environment,
      })),
    ).toEqual([
      {
        channel: 'push',
        status: 'sent',
        statusCode: 200,
        tokenInvalid: false,
        environment: 'production',
      },
      {
        channel: 'push',
        status: 'failed',
        statusCode: 410,
        tokenInvalid: true,
        environment: 'development',
      },
      { channel: 'email', status: 'sent', statusCode: 200, tokenInvalid: false, environment: null },
    ])
    expect(result.deliveries[0]?.targetRef).toBe(await hashTarget(DEVICE_TOKEN))
    expect(result.deliveries[0]?.providerId).toBe(pushes[0]?.headers['apns-id'])

    const audited = await listDeliveries(db, { userId: 'u1' })
    expect(audited).toHaveLength(3)
    expect(JSON.stringify(audited)).not.toContain(DEVICE_TOKEN)
    expect(JSON.stringify(audited)).not.toContain('logan@example.com')
  })

  it('suppresses channels the user turned off and skips unconfigured ones, auditing both', async () => {
    const { notifier, pushes, emails } = await setup({ withEmail: false })
    await notifier.preferences.set({
      userId: 'u1',
      category: 'shore-power',
      channel: 'push',
      enabled: false,
    })
    const result = await notifier.send({
      userId: 'u1',
      category: 'shore-power',
      push: { notification: alert, targets: [{ deviceToken: DEVICE_TOKEN }] },
      email: { to: 'logan@example.com', subject: 's', text: 't' },
    })
    expect(pushes).toHaveLength(0)
    expect(emails).toHaveLength(0)
    expect(
      result.deliveries.map(({ channel, status, reason, pushType }) => ({
        channel,
        status,
        reason,
        pushType,
      })),
    ).toEqual([
      { channel: 'push', status: 'suppressed', reason: 'preference_off', pushType: 'alert' },
      // shore-power email defaults off, so it is suppressed before configuration matters.
      { channel: 'email', status: 'suppressed', reason: 'preference_off', pushType: null },
    ])
    const morning = await notifier.send({
      userId: 'u1',
      category: 'morning-message',
      email: { to: 'logan@example.com', subject: 's', text: 't' },
    })
    expect(morning.deliveries).toMatchObject([
      { channel: 'email', status: 'skipped', reason: 'channel_not_configured' },
    ])
    expect(await listDeliveries(db, { userId: 'u1' })).toHaveLength(3)
  })

  it('still sends defaults and mandatory channels when the preference read fails', async () => {
    const { pushes } = await setup()
    const failingRead: NotifyD1Database = {
      prepare: (sql) => {
        if (sql.startsWith('SELECT category')) throw new Error('D1 read failed')
        return db.prepare(sql)
      },
      batch: (statements) => db.batch(statements),
    }
    const key = await generateTestApnsKey()
    const notifier = createNotifier({
      db: failingRead,
      categories: CATEGORIES,
      apns: createApnsClient({
        bundleId: 'at.mybo.app',
        environment: 'production',
        credentials: { teamId: 'T', keyId: 'K', privateKey: key.p8 },
        transport: async () => ({ status: 200, headers: {}, body: '' }),
      }),
    })
    const result = await notifier.send({
      userId: 'u1',
      category: 'anchor-alarm',
      push: { notification: alert, targets: [{ deviceToken: DEVICE_TOKEN }] },
    })
    expect(result.preferencesError).toBeInstanceOf(Error)
    expect(result.deliveries).toMatchObject([{ status: 'sent' }])
    expect(pushes).toHaveLength(0)
    expect(await listDeliveries(db, { userId: 'u1' })).toHaveLength(1)
  })

  it('records a bad target or a provider rejection as failed rows instead of throwing', async () => {
    const { notifier, pushes } = await setup({ emailFails: true })
    const result = await notifier.send({
      userId: 'u1',
      category: 'anchor-alarm',
      push: {
        notification: alert,
        targets: [{ deviceToken: 'not-hex' }, { deviceToken: DEVICE_TOKEN }],
      },
      email: { to: ['a@example.com', 'b@example.com'], subject: 's', text: 't' },
    })
    expect(pushes).toHaveLength(1)
    expect(result.deliveries[0]?.targetRef).toBe(await hashTarget('not-hex'))
    expect(result.deliveries.map(({ status, reason }) => ({ status, reason }))).toEqual([
      { status: 'failed', reason: 'invalid_device_token' },
      { status: 'sent', reason: null },
      { status: 'failed', reason: 'validation_error' },
    ])
  })

  it('refuses an unknown category before sending, and returns audit failures without losing sends', async () => {
    const { notifier, pushes } = await setup()
    await expect(notifier.send({ userId: 'u1', category: 'nope' })).rejects.toBeInstanceOf(
      NotifyError,
    )

    const broken = createNotifier({
      db: { prepare: db.prepare.bind(db), batch: () => Promise.reject(new Error('D1 down')) },
      categories: CATEGORIES,
      apns: createApnsClient({
        bundleId: 'at.mybo.app',
        environment: 'production',
        credentials: { teamId: 'T', keyId: 'K', privateKey: (await generateTestApnsKey()).p8 },
        transport: async () => ({ status: 200, headers: {}, body: '' }),
      }),
    })
    const result = await broken.send({
      userId: 'u1',
      category: 'shore-power',
      push: { notification: alert, targets: [{ deviceToken: DEVICE_TOKEN }] },
    })
    expect(result.deliveries).toMatchObject([{ status: 'sent' }])
    expect(result.auditError).toBeInstanceOf(Error)
    expect(pushes).toHaveLength(0)
  })
})
