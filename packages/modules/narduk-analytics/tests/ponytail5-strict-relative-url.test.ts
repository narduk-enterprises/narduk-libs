// @vitest-environment happy-dom
// Ponytail-5 repro (#2003 analytics-seo-devices #2): strict mode must template a
// relative `$…url` the way it templates an absolute one.
import { describe, expect, it } from 'vitest'

import { createStrictPrivacyBeforeSend } from '../app/utils/analyticsPrivacy'

import type { CaptureResult } from 'posthog-js'

const resolveRoute = (path: string) => ({
  matched: /^\/farms\/[^/]+$/u.test(path) ? [{ path: '/farms/:farmId' }] : [],
})

describe('strict privacy: relative URL properties', () => {
  it('does not send a relative $current_url path, query or fragment raw', () => {
    const beforeSend = createStrictPrivacyBeforeSend({
      origin: 'https://acre.example',
      resolveRoute,
    })
    const out = beforeSend({
      uuid: 'u',
      event: '$pageleave',
      properties: { $current_url: '/farms/frm_1?token=invite-secret#frag' },
    } as CaptureResult)
    expect(out?.properties.$current_url).not.toContain('invite-secret')
    expect(out?.properties.$current_url).toBe('/farms/:farmId')
  })
})
