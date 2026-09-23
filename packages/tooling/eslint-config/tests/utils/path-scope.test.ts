import { describe, expect, it } from 'vitest'

import {
  inAppScope,
  inTestOrFixtureDirectory,
  isTestOrFixturePath,
  segmentsAfter,
  toPosixPath,
} from '../../src/rules/utils/path-scope'

describe('inAppScope', () => {
  describe('the leading-slash bug class', () => {
    // v1 gated on `filename.includes('/app/stores/')`. `eslint .` reports
    // relative filenames, so eight rules were permanently off in the
    // configuration apps actually run.
    it('matches a relative filename', () => {
      expect(inAppScope('app/stores/user.ts', 'app', 'stores')).toBe(true)
    })

    it('matches the same file spelled absolutely', () => {
      expect(inAppScope('/repo/app/stores/user.ts', 'app', 'stores')).toBe(true)
    })

    it('matches a `./`-prefixed filename', () => {
      expect(inAppScope('./app/stores/user.ts', 'app', 'stores')).toBe(true)
    })

    it('matches a Windows filename', () => {
      expect(inAppScope('C:\\repo\\app\\stores\\user.ts', 'app', 'stores')).toBe(true)
    })

    it('tolerates doubled and trailing separators', () => {
      expect(inAppScope('/app//stores//user.ts', 'app', 'stores')).toBe(true)
    })
  })

  describe('the `myapp/app/` first-index bug', () => {
    // Searching for the bare substring `app/` finds the tail of `myapp/`.
    it('does not treat `myapp` as `app`', () => {
      expect(inAppScope('packages/myapp/stores/user.ts', 'app', 'stores')).toBe(false)
    })

    it('still matches the real app root further down the same path', () => {
      expect(inAppScope('packages/myapp/app/stores/user.ts', 'app', 'stores')).toBe(true)
    })

    it('does not match a segment that merely starts with the wanted name', () => {
      expect(inAppScope('application/stores/user.ts', 'app', 'stores')).toBe(false)
    })

    it('does not match a segment that merely ends with the wanted name', () => {
      expect(inAppScope('legacy-app/stores/user.ts', 'app', 'stores')).toBe(false)
    })
  })

  describe('segment semantics', () => {
    it('requires the segments to be contiguous', () => {
      expect(inAppScope('app/nested/stores/user.ts', 'app', 'stores')).toBe(false)
    })

    it('requires the segments in the given order', () => {
      expect(inAppScope('stores/app/user.ts', 'app', 'stores')).toBe(false)
    })

    it('accepts a single slash-joined argument', () => {
      expect(inAppScope('app/stores/user.ts', 'app/stores')).toBe(
        inAppScope('app/stores/user.ts', 'app', 'stores'),
      )
    })

    it('matches a single segment anywhere above the file', () => {
      expect(inAppScope('server/api/users.post.ts', 'server')).toBe(true)
      expect(inAppScope('/repo/server/api/users.post.ts', 'server')).toBe(true)
    })

    it('does not match a file whose name equals the segment', () => {
      expect(inAppScope('server.ts', 'server')).toBe(false)
      expect(inAppScope('src/server', 'server')).toBe(false)
    })

    it('does not match the directory itself', () => {
      expect(inAppScope('app/stores', 'app', 'stores')).toBe(false)
    })

    it('matches deeply nested files under the scope', () => {
      expect(inAppScope('app/stores/user/profile.ts', 'app', 'stores')).toBe(true)
    })
  })

  describe('degenerate input', () => {
    it('returns false with no segments', () => {
      expect(inAppScope('app/stores/user.ts')).toBe(false)
    })

    it('returns false for an empty filename', () => {
      expect(inAppScope('', 'app')).toBe(false)
    })

    it('returns false for the RuleTester placeholder filename', () => {
      expect(inAppScope('<input>', 'app')).toBe(false)
    })

    it('ignores empty and `.` segment arguments', () => {
      expect(inAppScope('app/stores/user.ts', '', '.', 'app', 'stores')).toBe(true)
    })
  })
})

describe('segmentsAfter', () => {
  it('returns the segments below the first matching run', () => {
    expect(segmentsAfter('app/components/orders/Row.vue', 'app', 'components')).toEqual([
      'orders',
      'Row.vue',
    ])
    expect(segmentsAfter('C:\\repo\\components\\Row.vue', 'components')).toEqual(['Row.vue'])
  })

  it('never matches inside a segment (narduk-libs#777)', () => {
    // `indexOf('components/')` matched the tail of `app-components/` here.
    expect(
      segmentsAfter(
        '/w/core-module-app-components/repo/app/components/app/Header.vue',
        'components',
      ),
    ).toEqual(['app', 'Header.vue'])
    expect(segmentsAfter('/w/app-components/Header.vue', 'components')).toBeNull()
  })

  it('agrees with inAppScope on what is inside the directory', () => {
    expect(segmentsAfter('app/components', 'app', 'components')).toBeNull()
    expect(segmentsAfter('app/pages/index.vue', 'components')).toBeNull()
    expect(segmentsAfter('app/components/Row.vue')).toBeNull()
  })
})

describe('isTestOrFixturePath', () => {
  it.each([
    'tests/server/api.test.ts',
    '/repo/tests/server/api.ts',
    'tests/helpers.ts',
    '__tests__/store.ts',
    '__test__/store.ts',
    'e2e/login.spec.ts',
    'e2e/helpers.ts',
    'fixtures/app.vue',
    '__fixtures__/app.vue',
    '__mocks__/db.ts',
    'app/stores/user.test.ts',
    'app/stores/user.spec.ts',
    'src/rules/helper.test.utils.ts',
    'Tests/server/api.ts',
    'C:\\repo\\tests\\api.ts',
  ])('treats %s as test or fixture code', (filename) => {
    expect(isTestOrFixturePath(filename)).toBe(true)
  })

  it.each([
    'app/pages/index.vue',
    'server/api/users.post.ts',
    'app/stores/user.ts',
    'src/rules/utils/path-scope.ts',
    'tests.ts',
    'contest/index.ts',
    'latest/index.ts',
    '',
    '<input>',
  ])('treats %s as production code', (filename) => {
    expect(isTestOrFixturePath(filename)).toBe(false)
  })

  it('fires for a relative tests/ path that v1 missed', () => {
    // v1's copies checked `includes('/tests/')`, which needs a leading slash.
    expect(isTestOrFixturePath('tests/server/api.ts')).toBe(true)
  })
})

describe('inTestOrFixtureDirectory', () => {
  it.each([
    'tests/server/api.ts',
    '/repo/tests/server/api/users.post.ts',
    'server/api/__tests__/users.post.ts',
    'server/api/fixtures/seed.post.ts',
    'e2e/login.ts',
    '__mocks__/db.ts',
    'Tests/server/api.ts',
    'C:\\repo\\tests\\api.ts',
    // A directory carrying the infix is still a test directory.
    'app/helpers.spec.d/case.ts',
  ])('exempts %s — it lives in a test or fixture directory', (filename) => {
    expect(inTestOrFixtureDirectory(filename)).toBe(true)
  })

  it.each([
    // The adversarial fixture: Nitro deploys this as POST /api/deploy.test.
    'server/api/deploy.test.post.ts',
    'server/routes/hooks.spec.put.ts',
    'app/stores/user.test.ts',
    'server/api/users.post.ts',
    'tests.ts',
    '',
  ])('does NOT exempt %s — the basename is not a deployment boundary', (filename) => {
    expect(inTestOrFixtureDirectory(filename)).toBe(false)
  })

  it('differs from isTestOrFixturePath exactly on the basename infix', () => {
    // This is the whole delta, stated as one assertion pair: the shared
    // exemption suppressed the entire server security tier on a live route
    // because the file was *named* like a test.
    expect(isTestOrFixturePath('server/api/deploy.test.post.ts')).toBe(true)
    expect(inTestOrFixtureDirectory('server/api/deploy.test.post.ts')).toBe(false)
  })
})

describe('toPosixPath', () => {
  it('normalizes Windows separators', () => {
    expect(toPosixPath('C:\\repo\\app\\index.ts')).toBe('C:/repo/app/index.ts')
  })

  it('returns an empty string for non-string input', () => {
    expect(toPosixPath(undefined as unknown as string)).toBe('')
  })
})
