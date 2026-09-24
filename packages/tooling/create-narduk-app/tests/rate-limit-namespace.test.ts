import { describe, expect, it } from 'vitest'

import { buildGeneratedFiles } from '../src/index.js'
import { rateLimitNamespacePrefix } from '../src/rate-limit-namespace.js'

function wranglerFor(appName: string): string {
  const file = buildGeneratedFiles({
    appName,
    capabilities: [],
    noGit: true,
    targetDir: `/tmp/${appName}`,
  }).find((entry) => entry.path === 'apps/web/wrangler.jsonc')
  if (!file) throw new Error('no wrangler.jsonc generated')
  return file.contents
}

describe('rate-limit namespace prefix (narduk-libs#433)', () => {
  it("matches narduk-core's rateLimitNamespacePrefix on its pinned vectors", () => {
    // narduk-core tests/rate-limit-namespace.test.ts pins 'a'; its README
    // derives riverstatus's RL_120 id as 32195120.
    expect(rateLimitNamespacePrefix('a')).toBe('12220')
    expect(rateLimitNamespacePrefix('riverstatus')).toBe('32195')
  })

  it("writes the app's own prefix into wrangler.jsonc, stable per name, distinct across names", () => {
    const first = wranglerFor('fixture-one')
    expect(first).toContain(`this app's prefix is ${rateLimitNamespacePrefix('fixture-one')},`)
    expect(first).toContain(`"namespace_id": "${rateLimitNamespacePrefix('fixture-one')}120"`)
    expect(wranglerFor('fixture-one')).toBe(first)
    expect(rateLimitNamespacePrefix('fixture-two')).not.toBe(
      rateLimitNamespacePrefix('fixture-one'),
    )
    expect(wranglerFor('fixture-two')).toContain(rateLimitNamespacePrefix('fixture-two'))
  })

  it('emits no ratelimits binding and no scaffold id', () => {
    const text = wranglerFor('fixture-one')
    const live = text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    expect(live).not.toContain('ratelimits')
    for (const id of ['1001', '50110', '50121', '50300']) {
      expect(text).not.toMatch(new RegExp(`"namespace_id": "${id}"`, 'u'))
    }
  })
})
