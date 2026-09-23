import { RuleTester } from 'eslint'
import { describe, expect, it } from 'vitest'

import misuse from '../../../src/rules/server/no-csrf-exempt-route-misuse'
import requireCsrf from '../../../src/rules/server/require-csrf-header-on-mutations'
import { isDeclaredCsrfExempt, routeUrlPath } from '../../../src/rules/utils/mutation-route'

RuleTester.describe = describe
RuleTester.it = it

// narduk-libs#510: routes an app declares in `nardukCore.csrf.exemptPaths`
// bypass the CSRF middleware, so the lint rules must treat them as exempt too.
const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

const declared = [{ exemptPaths: ['/api/devices/ingest', '/api/sensors/*'] }]
const unverified = `export default defineEventHandler(async (event) => save(await readBody(event)))`
const verified = `export default defineEventHandler(async (event) => {
  const key = getHeader(event, 'x-api-key')
  if (!(await verifyDeviceKey(key))) throw createError({ statusCode: 401 })
  return save(await readBody(event))
})`

ruleTester.run('no-csrf-exempt-route-misuse (declared exemptPaths)', misuse, {
  valid: [
    {
      name: 'a declared path that verifies a credential header',
      filename: 'server/api/devices/ingest.post.ts',
      options: declared,
      code: verified,
    },
    {
      name: 'an undeclared path is not exempt, so this rule has nothing to say',
      filename: 'server/api/devices/other.post.ts',
      options: declared,
      code: unverified,
    },
    {
      name: 'without the option a declared-only route is not exempt',
      filename: 'server/api/devices/ingest.post.ts',
      code: unverified,
    },
  ],
  invalid: [
    {
      name: 'a declared path that reads a body with no credential check',
      filename: 'server/api/devices/ingest.post.ts',
      options: declared,
      code: unverified,
      errors: [{ messageId: 'missingSecretValidation' }],
    },
    {
      name: 'a /* entry covers a dynamic route beneath it',
      filename: 'server/api/sensors/[id]/reading.post.ts',
      options: declared,
      code: unverified,
      errors: [{ messageId: 'missingSecretValidation' }],
    },
  ],
})

ruleTester.run('require-csrf-header-on-mutations (declared exemptPaths)', requireCsrf, {
  valid: [
    {
      name: 'a declared path is exempt from the browser CSRF header',
      filename: 'server/api/devices/ingest.post.ts',
      options: declared,
      code: verified,
    },
  ],
  invalid: [
    {
      name: 'the same route, undeclared, still needs the CSRF header',
      filename: 'server/api/devices/ingest.post.ts',
      code: verified,
      errors: [{ messageId: 'routeMissingCsrfCheck' }],
    },
  ],
})

describe('routeUrlPath / isDeclaredCsrfExempt', () => {
  it('maps route files to the URL path Nitro serves', () => {
    expect(routeUrlPath('api', 'devices/ingest.post.ts')).toBe('/api/devices/ingest')
    expect(routeUrlPath('api', 'devices/index.ts')).toBe('/api/devices')
    expect(routeUrlPath('api', 'index.get.ts')).toBe('/api')
    expect(routeUrlPath('routes', 'hooks/[id].put.ts')).toBe('/hooks/[id]')
    expect(routeUrlPath('routes', 'index.ts')).toBe('/')
  })

  it("matches like narduk-core's isCsrfExemptPath", () => {
    expect(isDeclaredCsrfExempt('/api/devices/ingest', ['/api/devices/ingest/'])).toBe(true)
    expect(isDeclaredCsrfExempt('/api/devices/ingest', ['/api/devices'])).toBe(false)
    expect(isDeclaredCsrfExempt('/api/devices/[id]', ['/api/devices/*'])).toBe(true)
    expect(isDeclaredCsrfExempt('/api/devices', ['/api/devices/*'])).toBe(false)
    expect(isDeclaredCsrfExempt('/api/devices/ingest', [])).toBe(false)
  })
})
