import { describe, expect, it } from 'vitest'

import { errorRobotsRule } from '../shared/errorRobots'
import { hostAwareNoindexRule } from '../shared/hostAwareIndexing'

describe('errorRobotsRule', () => {
  it('returns noindex for 4xx and 5xx statuses', () => {
    for (const status of [400, 404, 410, 500, 503, '404']) {
      expect(errorRobotsRule(status)).toBe(hostAwareNoindexRule)
    }
  })

  it('leaves success and redirect statuses to the route rule', () => {
    for (const status of [200, 204, 301, 302, 399]) {
      expect(errorRobotsRule(status)).toBeUndefined()
    }
  })

  it('ignores a status that is not an integer', () => {
    for (const status of [undefined, null, '', 'abc', 404.5]) {
      expect(errorRobotsRule(status)).toBeUndefined()
    }
  })
})
