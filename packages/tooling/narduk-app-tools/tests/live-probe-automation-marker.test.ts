import { describe, expect, it } from 'vitest'

import { createLiveProbe, withAutomationMarker } from '../src/live-probe.js'

describe('live probe automation marker', () => {
  it('appends NardukAutomation/narduk-app-tools to every user agent once', () => {
    expect(withAutomationMarker('narduk-app-tools/live-probe')).toBe(
      'narduk-app-tools/live-probe NardukAutomation/narduk-app-tools',
    )
    expect(withAutomationMarker('x NardukAutomation/lighthouse')).toBe(
      'x NardukAutomation/lighthouse',
    )
  })

  it('sends the marked user agent, including for a caller-chosen one', async () => {
    const seen: string[] = []
    const transport = async (_target: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('user-agent') ?? '')
      return new Response('ok', { status: 200 })
    }
    await createLiveProbe({}, transport)('https://example.test/')
    await createLiveProbe({ userAgent: 'custom/1' }, transport)('https://example.test/')
    expect(seen).toEqual([
      'narduk-app-tools/live-probe NardukAutomation/narduk-app-tools',
      'custom/1 NardukAutomation/narduk-app-tools',
    ])
  })
})
