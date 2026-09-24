import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { rateLimitNamespaceCheck } from '../src/doctor.js'
import {
  SCAFFOLD_NAMESPACE_IDS,
  rateLimitBindings,
  rateLimitNamespaceIssues,
} from '../src/rate-limit-namespaces.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function wrangler(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rl-ns-'))
  dirs.push(dir)
  const path = join(dir, 'wrangler.jsonc')
  writeFileSync(path, text)
  return path
}

const limit = (name: string, id: string | number) => ({
  name,
  namespace_id: id,
  simple: { limit: 120, period: 60 },
})

describe('rateLimitNamespaceIssues', () => {
  it("accepts Buoys' own unique ids", () => {
    const config = { ratelimits: [limit('RL_300', '2869300'), limit('RL_120', '2869120')] }
    expect(rateLimitNamespaceIssues(config)).toEqual([])
  })

  it('refuses every scaffold id', () => {
    for (const id of SCAFFOLD_NAMESPACE_IDS) {
      const issues = rateLimitNamespaceIssues({ ratelimits: [limit('RL_300', id)] })
      expect(issues).toHaveLength(1)
      expect(issues[0]).toContain(`namespace_id ${id}, a scaffold id`)
    }
  })

  it('refuses an id reused across env scopes, and a numeric id counts the same', () => {
    const config = {
      ratelimits: [limit('RL_120', '32195120')],
      env: { preview: { ratelimits: [limit('RL_120', 32195120)] } },
    }
    expect(rateLimitBindings(config).map((binding) => binding.scope)).toEqual([
      'ratelimits',
      'env.preview.ratelimits',
    ])
    expect(rateLimitNamespaceIssues(config)).toEqual([
      'namespace_id 32195120 is declared 2 times (ratelimits RL_120, env.preview.ratelimits ' +
        'RL_120), so they share one set of counters',
    ])
  })

  it('refuses a binding with no namespace_id', () => {
    expect(rateLimitNamespaceIssues({ ratelimits: [{ name: 'RL_60' }] })).toEqual([
      'ratelimits RL_60 declares no namespace_id',
    ])
  })

  it('refuses an id that is not a positive decimal integer (#509)', () => {
    const config = {
      ratelimits: [limit('RL_A', 'abc'), limit('RL_B', '0x1F'), limit('RL_C', '0120')],
      env: { preview: { ratelimits: [limit('RL_D', -5), limit('RL_E', 1.5)] } },
    }
    expect(rateLimitNamespaceIssues(config)).toEqual([
      'ratelimits RL_A has namespace_id "abc", which is not a positive decimal integer',
      'ratelimits RL_B has namespace_id "0x1F", which is not a positive decimal integer',
      'ratelimits RL_C has namespace_id "0120", which is not a positive decimal integer',
      'env.preview.ratelimits RL_D has namespace_id "-5", which is not a positive decimal integer',
      'env.preview.ratelimits RL_E has namespace_id "1.5", which is not a positive decimal integer',
    ])
  })

  it("mirrors narduk-core's scaffold list", () => {
    const core = readFileSync(
      new URL(
        '../../../modules/narduk-core/runtime/shared/rate-limit-namespace.ts',
        import.meta.url,
      ),
      'utf8',
    )
    const block = /RATE_LIMIT_SCAFFOLD_NAMESPACE_IDS[^=]*=\s*\[([^\]]*)\]/u.exec(core)?.[1] ?? ''
    expect([...block.matchAll(/'(\d+)'/gu)].map((match) => match[1])).toEqual([
      ...SCAFFOLD_NAMESPACE_IDS,
    ])
  })
})

describe('doctor rate-limit namespace check', () => {
  it('passes a config with no ratelimits, and a JSONC one with unique ids', () => {
    expect(rateLimitNamespaceCheck(wrangler('{ "name": "app" }')).status).toBe('pass')
    const path = wrangler(
      '{\n  // comment\n  "ratelimits": [{ "name": "RL_300", "namespace_id": "2869300" },],\n}\n',
    )
    expect(rateLimitNamespaceCheck(path)).toEqual({
      detail: '1 binding(s), every namespace_id distinct',
      name: 'rate-limit namespace ids',
      status: 'pass',
    })
  })

  it('fails the scaffold 50300 and names the fix', () => {
    const check = rateLimitNamespaceCheck(
      wrangler(JSON.stringify({ ratelimits: [limit('RL_300', '50300')] })),
    )
    expect(check.status).toBe('fail')
    expect(check.detail).toContain('rateLimitNamespaceId(workerName, limit)')
  })
})
