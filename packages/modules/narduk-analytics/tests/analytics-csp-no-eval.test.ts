import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

// narduk-libs#1310. Zod probes `new Function('')` while building its first object
// schema; an enforced no-eval CSP reports that probe even though Zod catches the
// throw. This file owns its module graph (vitest isolates each test file), so the
// import below is the first object-schema build in the process, as in a browser
// chunk, and `Function` is recorded from before it.

const functionCalls: string[] = []
const OriginalFunction = globalThis.Function

describe('analytics catalog under a no-eval CSP', () => {
  beforeAll(() => {
    globalThis.Function = new Proxy(OriginalFunction, {
      apply(_target, _this, args) {
        functionCalls.push(String(args.at(-1) ?? ''))
        throw new EvalError('Refused to evaluate a string as JavaScript (CSP stub)')
      },
      construct(_target, args) {
        functionCalls.push(String(args.at(-1) ?? ''))
        throw new EvalError('Refused to evaluate a string as JavaScript (CSP stub)')
      },
    })
  })
  afterAll(() => {
    globalThis.Function = OriginalFunction
  })

  it('never calls Function on import, on factory-built app catalogs, or on validate', async () => {
    const { defineAnalyticsEvents, standardAnalyticsEvents, withJitlessSchemas } =
      await import('../app/utils/analyticsEvents')
    expect(functionCalls).toEqual([])

    const app = defineAnalyticsEvents(() => ({
      primary_action_completed: z.object({ source: z.enum(['map', 'list']) }).strict(),
    }))
    expect(app.primary_action_completed.safeParse({ source: 'map' }).success).toBe(true)
    expect(app.primary_action_completed.safeParse({ source: 'map', extra: 1 }).success).toBe(false)

    expect(standardAnalyticsEvents.share_clicked.safeParse({ action_id: 'share' }).success).toBe(
      false,
    )
    expect(
      standardAnalyticsEvents.share_clicked.safeParse({ action_id: 'share', channel: 'native' })
        .success,
    ).toBe(true)
    expect(
      standardAnalyticsEvents.page_engagement.safeParse({
        active_ms: 10,
        page_visit_id: '2f1c7f8e-6a52-4a3c-9f0e-0c8d1b7e4a11',
        email: 'private@example.com',
      }).success,
    ).toBe(false)
    for (const schema of Object.values(standardAnalyticsEvents)) {
      schema.safeParse({})
    }
    withJitlessSchemas(() => z.object({ a: z.string() }).strict().safeParse({ a: 'x' }))

    expect(functionCalls).toEqual([])
  })

  it('restores the app Zod jitless setting, also when the build throws', async () => {
    const { withJitlessSchemas } = await import('../app/utils/analyticsEvents')
    const before = z.config().jitless
    withJitlessSchemas(() => expect(z.config().jitless).toBe(true))
    expect(z.config().jitless).toBe(before)
    expect(() =>
      withJitlessSchemas(() => {
        throw new Error('build failed')
      }),
    ).toThrow('build failed')
    expect(z.config().jitless).toBe(before)
  })
})
