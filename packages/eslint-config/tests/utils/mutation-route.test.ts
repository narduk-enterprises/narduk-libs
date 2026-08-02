import { Linter, type Rule, type SourceCode } from 'eslint'
import { describe, expect, it } from 'vitest'

import {
  analyzeMutationRoute,
  analyzeServerRoutePath,
  collectHandlerDeclaredMethods,
  hasUnresolvableMethod,
  isCsrfExemptRoutePath,
  isExemptTestPath,
  isServerRouteFile,
  resolveAliasedName,
  resolveIdentifierAliasChain,
  shouldGuardMutations,
  unwrapTsWrappers,
} from '../../src/rules/utils/mutation-route'

/**
 * Parse real source into a real ESLint SourceCode, so the AST half of the gate
 * is exercised through the same machinery a rule sees. v1's suites bypassed the
 * gate entirely with `testMode: true`; nothing here may.
 */
function sourceCodeOf(code: string): SourceCode {
  const linter = new Linter()
  let captured: SourceCode | null = null
  linter.verify(code, {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    plugins: {
      probe: {
        rules: {
          capture: {
            create(context: Rule.RuleContext): Rule.RuleListener {
              captured = context.sourceCode
              return {}
            },
          },
        },
      },
    },
    rules: { 'probe/capture': 'error' },
  })
  if (!captured) throw new Error('failed to capture SourceCode')
  return captured
}

describe('analyzeServerRoutePath', () => {
  it('classifies absolute and relative filenames identically (v1 leading-slash bug)', () => {
    const absolute = analyzeServerRoutePath('/Users/dev/app/server/api/users.post.ts')
    const relative = analyzeServerRoutePath('server/api/users.post.ts')

    for (const info of [absolute, relative]) {
      expect(info.isServerRoute).toBe(true)
      expect(info.area).toBe('api')
      expect(info.filenameMethod).toBe('post')
      expect(info.routeRelativePath).toBe('users.post.ts')
    }
  })

  it('covers server/routes/** as well as server/api/** (v1 covered only api)', () => {
    const info = analyzeServerRoutePath('server/routes/webhooks/stripe.post.ts')
    expect(info.isServerRoute).toBe(true)
    expect(info.area).toBe('routes')
    expect(info.filenameMethod).toBe('post')
  })

  it('normalizes Windows separators', () => {
    const info = analyzeServerRoutePath(String.raw`C:\repo\server\api\orders.patch.ts`)
    expect(info.isServerRoute).toBe(true)
    expect(info.filenameMethod).toBe('patch')
  })

  it('takes the innermost server/api root in a monorepo path', () => {
    const info = analyzeServerRoutePath(
      '/repo/packages/server/api/legacy/apps/web/server/api/items.delete.ts',
    )
    expect(info.routeRelativePath).toBe('items.delete.ts')
    expect(info.filenameMethod).toBe('delete')
  })

  it('handles nested route segments and dynamic params', () => {
    const info = analyzeServerRoutePath('server/api/orgs/[orgId]/members/[id].delete.ts')
    expect(info.filenameMethod).toBe('delete')
    expect(info.routeRelativePath).toBe('orgs/[orgId]/members/[id].delete.ts')
  })

  it('returns no method for a method-less route file', () => {
    const info = analyzeServerRoutePath('server/api/users.ts')
    expect(info.isServerRoute).toBe(true)
    expect(info.filenameMethod).toBeNull()
  })

  it('does not treat a test file suffix as a method', () => {
    expect(analyzeServerRoutePath('server/api/users.post.test.ts').filenameMethod).toBeNull()
  })

  it('accepts every Nitro route extension', () => {
    for (const extension of ['ts', 'js', 'mjs', 'mts', 'cts', 'cjs']) {
      expect(analyzeServerRoutePath(`server/api/x.post.${extension}`).filenameMethod).toBe('post')
    }
  })

  it('rejects non-route paths', () => {
    expect(isServerRouteFile('app/composables/useThing.ts')).toBe(false)
    expect(isServerRouteFile('src/server.ts')).toBe(false)
    expect(isServerRouteFile('')).toBe(false)
  })

  it('flags the CSRF-exempt prefixes on both route areas', () => {
    expect(isCsrfExemptRoutePath('server/api/webhooks/stripe.post.ts')).toBe(true)
    expect(isCsrfExemptRoutePath('server/api/cron/rollup.post.ts')).toBe(true)
    expect(isCsrfExemptRoutePath('server/api/callbacks/oauth.post.ts')).toBe(true)
    expect(isCsrfExemptRoutePath('server/routes/webhooks/github.post.ts')).toBe(true)
    expect(isCsrfExemptRoutePath('server/api/users.post.ts')).toBe(false)
  })
})

describe('collectHandlerDeclaredMethods', () => {
  const cases: Array<[string, string, string[]]> = [
    [
      'assertMethod literal',
      `export default defineEventHandler(async (event) => { assertMethod(event, 'POST') })`,
      ['POST'],
    ],
    [
      'assertMethod array',
      `export default defineEventHandler((event) => { assertMethod(event, ['POST', 'PUT']) })`,
      ['POST', 'PUT'],
    ],
    [
      'isMethod guard',
      `export default defineEventHandler((event) => { if (!isMethod(event, 'DELETE')) return })`,
      ['DELETE'],
    ],
    [
      'event.method equality',
      `export default defineEventHandler((event) => { if (event.method === 'PATCH') return 1 })`,
      ['PATCH'],
    ],
    [
      'event.method inequality declares the served method',
      `export default defineEventHandler((event) => { if (event.method !== 'POST') throw new Error('x') })`,
      ['POST'],
    ],
    [
      'event.node.req.method',
      `export default defineEventHandler((event) => { if (event.node.req.method === 'PUT') return 1 })`,
      ['PUT'],
    ],
    [
      'getMethod() accessor',
      `export default defineEventHandler((event) => { const m = getMethod(event); if (m === 'DELETE') return 1 })`,
      ['DELETE'],
    ],
    [
      'switch on event.method',
      `export default defineEventHandler((event) => { switch (event.method) { case 'POST': return 1; case 'GET': return 2 } })`,
      ['GET', 'POST'],
    ],
    [
      'array includes',
      `export default defineEventHandler((event) => { if (['POST', 'PATCH'].includes(event.method)) return 1 })`,
      ['PATCH', 'POST'],
    ],
    [
      'handler option object',
      `export default defineEventHandler({ method: 'POST', handler: () => 1 })`,
      ['POST'],
    ],
    [
      'router declaration',
      `const router = createRouter(); router.post('/things', defineEventHandler(() => 1))`,
      ['POST'],
    ],
    [
      'read-only handler',
      `export default defineEventHandler((event) => { assertMethod(event, 'GET') })`,
      ['GET'],
    ],
    [
      'no declaration at all',
      `export default defineEventHandler(async (event) => { return await readBody(event) })`,
      [],
    ],
    [
      'unrelated object with a post method is not a router',
      `const analytics = { post(x) { return x } }; analytics.post('/thing')`,
      [],
    ],
    [
      'client $fetch method option is not a route declaration',
      `const res = await $fetch('/api/x', { method: 'POST' })`,
      [],
    ],
  ]

  for (const [name, code, expected] of cases) {
    it(name, () => {
      const methods = [...collectHandlerDeclaredMethods(sourceCodeOf(code).ast)].sort()
      expect(methods).toEqual(expected)
    })
  }
})

describe('analyzeMutationRoute', () => {
  it('classifies by filename suffix alone', () => {
    const info = analyzeMutationRoute('server/api/users.post.ts', sourceCodeOf('export default 1'))
    expect(info.isMutationRoute).toBe(true)
    expect(info.disposition).toBe('mutation')
    expect(info.methodSource).toBe('filename')
    expect(info.declaredMethods).toEqual(['POST'])
  })

  it('survives a rename: the handler still declares the method', () => {
    // The exact v1 failure mode — `create.post.ts` renamed to `create.ts`
    // silently disabled four security rules. Here the handler still proves it.
    const info = analyzeMutationRoute(
      'server/api/create.ts',
      sourceCodeOf(
        `export default defineEventHandler(async (event) => { assertMethod(event, 'POST'); return readBody(event) })`,
      ),
    )
    expect(info.isMutationRoute).toBe(true)
    expect(info.methodSource).toBe('handler')
  })

  it('reports both sources when filename and handler agree', () => {
    const info = analyzeMutationRoute(
      'server/api/create.post.ts',
      sourceCodeOf(`export default defineEventHandler((event) => assertMethod(event, 'POST'))`),
    )
    expect(info.methodSource).toBe('filename+handler')
    expect(info.declaredMethods).toEqual(['POST'])
  })

  it('covers server/routes mutation handlers', () => {
    const info = analyzeMutationRoute(
      'server/routes/hooks/github.ts',
      sourceCodeOf(`export default defineEventHandler((event) => assertMethod(event, 'POST'))`),
    )
    expect(info.isMutationRoute).toBe(true)
    expect(info.area).toBe('routes')
  })

  it('marks a declared read-only route as read-only, not unspecified', () => {
    const info = analyzeMutationRoute('server/api/users.get.ts', sourceCodeOf('export default 1'))
    expect(info.disposition).toBe('read-only')
    expect(info.isMutationRoute).toBe(false)
  })

  it('marks a method-less route unspecified rather than guessing read-only', () => {
    const info = analyzeMutationRoute(
      'server/api/users.ts',
      sourceCodeOf('export default defineEventHandler(() => 1)'),
    )
    expect(info.disposition).toBe('unspecified')
    expect(info.methodSource).toBeNull()
  })

  it('is not a server route outside server/api|routes', () => {
    const info = analyzeMutationRoute(
      'app/composables/useThing.ts',
      sourceCodeOf(`assertMethod(event, 'POST')`),
    )
    expect(info.isServerRoute).toBe(false)
    expect(info.isMutationRoute).toBe(false)
  })

  it('works without a SourceCode (pure path mode)', () => {
    expect(analyzeMutationRoute('server/api/x.delete.ts').isMutationRoute).toBe(true)
    expect(analyzeMutationRoute('server/api/x.ts').disposition).toBe('unspecified')
  })
})

/**
 * ADVERSARIAL 2. A handler whose method comes from a runtime value declares
 * nothing, lands on `unspecified`, and every rule that needs a proven mutation
 * goes quiet — a live POST endpoint with no enforcement and no diagnostics.
 * The gate cannot invent the method; it records that it could not read it.
 */
describe('indeterminate methods', () => {
  const analyze = (code: string, filename = 'server/api/things.ts') =>
    analyzeMutationRoute(filename, sourceCodeOf(code))

  it('flags a comparison against a runtime-derived value', () => {
    const info = analyze(`const method = ['POST'][0]
      export default defineEventHandler(async (event) => {
        if (getMethod(event) === method) return { mutated: true }
        return { read: true }
      })`)
    expect(info.disposition).toBe('unspecified')
    expect(info.hasIndeterminateMethod).toBe(true)
    expect(hasUnresolvableMethod(info)).toBe(true)
  })

  it.each([
    [`export default defineEventHandler((event) => event.method === resolveMethod())`],
    [`export default defineEventHandler((event) => isMethod(event, allowedMethods))`],
    [`export default defineEventHandler((event) => assertMethod(event, cfg.method))`],
    [`export default defineEventHandler((event) => allowed.includes(getMethod(event)))`],
    [
      `export default defineEventHandler((event) => { switch (event.method) { case pick(): return 1 } })`,
    ],
    // An interpolated template is not statically readable.
    [`export default defineEventHandler((event) => event.method === \`\${prefix}POST\`)`],
    // One hop of method aliasing, compared against an unreadable value.
    [
      `export default defineEventHandler((event) => {
        const m = getMethod(event)
        return m === cfg.method
      })`,
    ],
  ])('flags %s', (code) => {
    expect(analyze(code).hasIndeterminateMethod).toBe(true)
  })

  it.each([
    // Readable-but-not-a-method is determinate, not ambiguous.
    [`export default defineEventHandler((event) => event.method === 'PURGE')`],
    // A module-local string constant is readable.
    [
      `const POST = 'POST'
      export default defineEventHandler((event) => event.method === POST)`,
    ],
    [
      `const ALLOWED = ['POST', 'PUT']
      export default defineEventHandler((event) => ALLOWED.includes(event.method))`,
    ],
    // `default:` carries no test and is not a method claim.
    [
      `export default defineEventHandler((event) => { switch (event.method) { case 'POST': return 1; default: return 2 } })`,
    ],
    // No method comparison at all.
    [`export default defineEventHandler(async (event) => readBody(event))`],
  ])('does not flag %s', (code) => {
    expect(analyze(code).hasIndeterminateMethod).toBe(false)
  })

  it('resolves a literal constant to the method it names', () => {
    const info = analyze(`const POST = 'POST'
      export default defineEventHandler((event) => { if (event.method === POST) return save(event) })`)
    expect(info.declaredMethods).toEqual(['POST'])
    expect(info.isMutationRoute).toBe(true)
  })

  it('is not unresolvable when the FILENAME already pins the method', () => {
    // Nitro serves only GET from `things.get.ts`, so the unreadable branch
    // cannot become a mutation route however it evaluates.
    const info = analyze(
      `const method = ['POST'][0]
       export default defineEventHandler((event) => getMethod(event) === method)`,
      'server/api/things.get.ts',
    )
    expect(info.hasIndeterminateMethod).toBe(true)
    expect(hasUnresolvableMethod(info)).toBe(false)
  })

  it('is not unresolvable when the route is already a proven mutation', () => {
    const info = analyze(
      `export default defineEventHandler((event) => {
         assertMethod(event, 'POST')
         return event.method === pick()
       })`,
      'server/api/things.ts',
    )
    expect(info.isMutationRoute).toBe(true)
    expect(hasUnresolvableMethod(info)).toBe(false)
  })

  it('never reports outside a server route tree', () => {
    const info = analyze(
      `export const h = (event) => event.method === pick()`,
      'app/utils/thing.ts',
    )
    expect(info.hasIndeterminateMethod).toBe(false)
    expect(hasUnresolvableMethod(info)).toBe(false)
  })
})

/**
 * ADVERSARIAL 1. Every consumer of this gate compared a callee's *spelling*
 * against a name set, so one `const handler = defineEventHandler` line made a
 * mutation route invisible to the wrapper and rate-limit rules at once.
 */
describe('resolveIdentifierAliasChain / resolveAliasedName', () => {
  const HANDLERS = new Set(['defineEventHandler', 'definePublicMutation'])

  /** Resolve the callee of the file's last CallExpression statement. */
  function calleeOf(code: string): { node: unknown; sourceCode: SourceCode } {
    const sourceCode = sourceCodeOf(code)
    const last = sourceCode.ast.body.at(-1)
    if (!last) throw new Error('empty program')

    const expression =
      last.type === 'ExportDefaultDeclaration'
        ? last.declaration
        : last.type === 'ExpressionStatement'
          ? last.expression
          : null

    if (expression?.type !== 'CallExpression') {
      throw new Error(`expected a trailing call expression, got ${expression?.type ?? last.type}`)
    }

    return { node: expression.callee, sourceCode }
  }

  it('follows a one-hop alias to the real callee', () => {
    const { node, sourceCode } = calleeOf(`const handler = defineEventHandler
      export default handler(async (event) => event)`)
    expect(resolveIdentifierAliasChain(node, sourceCode)).toEqual(['handler', 'defineEventHandler'])
    expect(resolveAliasedName(node, sourceCode, HANDLERS)).toBe('defineEventHandler')
  })

  it('follows a multi-hop chain', () => {
    const { node, sourceCode } = calleeOf(`const inner = definePublicMutation
      const outer = inner
      export default outer(async (event) => event)`)
    expect(resolveAliasedName(node, sourceCode, HANDLERS)).toBe('definePublicMutation')
  })

  it('returns the direct name when there is no alias', () => {
    const { node, sourceCode } = calleeOf(`export default defineEventHandler((event) => event)`)
    expect(resolveIdentifierAliasChain(node, sourceCode)).toEqual(['defineEventHandler'])
  })

  it('does not follow a REASSIGNED binding', () => {
    // A second write means the value at the call site is not decidable, and a
    // security rule must not classify a call from a guess.
    const { node, sourceCode } = calleeOf(`let handler = defineEventHandler
      handler = somethingElse
      export default handler((event) => event)`)
    expect(resolveAliasedName(node, sourceCode, HANDLERS)).toBeNull()
  })

  it('does not follow a function parameter', () => {
    const { node, sourceCode } = calleeOf(`export function run(handler) { return handler(1) }
      run(defineEventHandler)`)
    expect(resolveAliasedName(node, sourceCode, HANDLERS)).toBe(null)
  })

  it('terminates on a self-referential chain', () => {
    const { node, sourceCode } = calleeOf(`const a = a
      export default a((event) => event)`)
    expect(resolveIdentifierAliasChain(node, sourceCode)).toEqual(['a'])
  })

  it('returns an empty chain for a non-identifier callee', () => {
    const { node, sourceCode } = calleeOf(`export default obj.method((event) => event)`)
    expect(resolveIdentifierAliasChain(node, sourceCode)).toEqual([])
    expect(resolveAliasedName(node, sourceCode, HANDLERS)).toBeNull()
  })

  it('is inert without a SourceCode', () => {
    const node = { type: 'Identifier', name: 'handler' }
    expect(resolveIdentifierAliasChain(node, null)).toEqual(['handler'])
  })
})

/**
 * ADVERSARIAL 6. `isTestOrFixturePath` suppressed the whole server tier on
 * `server/api/deploy.test.post.ts` — a route Nitro deploys.
 */
describe('isExemptTestPath', () => {
  it.each([
    'server/api/deploy.test.post.ts',
    'server/routes/hooks.spec.put.ts',
    '/repo/server/api/users.test.get.ts',
  ])('does NOT exempt the deployed route %s', (filename) => {
    expect(isExemptTestPath(filename)).toBe(false)
  })

  it.each([
    'tests/server/api/deploy.post.ts',
    'server/api/__tests__/deploy.post.ts',
    'server/api/fixtures/seed.post.ts',
  ])('still exempts %s — a real test or fixture directory', (filename) => {
    expect(isExemptTestPath(filename)).toBe(true)
  })

  it.each(['app/stores/user.test.ts', 'server/utils/db.test.ts', 'src/rules/x.spec.ts'])(
    'keeps the ordinary infix exemption for %s — not a route tree',
    (filename) => {
      expect(isExemptTestPath(filename)).toBe(true)
    },
  )

  it('leaves ordinary production files alone', () => {
    expect(isExemptTestPath('server/api/users.post.ts')).toBe(false)
    expect(isExemptTestPath('app/pages/index.vue')).toBe(false)
  })
})

describe('shouldGuardMutations', () => {
  const declared = analyzeMutationRoute('server/api/x.post.ts')
  const unspecified = analyzeMutationRoute('server/api/x.ts')
  const readOnly = analyzeMutationRoute('server/api/x.get.ts')
  const notRoute = analyzeMutationRoute('app/utils/x.ts')

  it('always guards a declared mutation route', () => {
    expect(shouldGuardMutations(declared)).toBe(true)
    expect(shouldGuardMutations(declared, { includeUnspecified: true })).toBe(true)
  })

  it('guards an unspecified route only on request', () => {
    expect(shouldGuardMutations(unspecified)).toBe(false)
    expect(shouldGuardMutations(unspecified, { includeUnspecified: true })).toBe(true)
  })

  it('never guards a declared read-only route or a non-route file', () => {
    expect(shouldGuardMutations(readOnly, { includeUnspecified: true })).toBe(false)
    expect(shouldGuardMutations(notRoute, { includeUnspecified: true })).toBe(false)
  })
})

describe('unwrapTsWrappers', () => {
  it('returns the innermost expression node', () => {
    const node = {
      type: 'TSAsExpression',
      expression: {
        type: 'ChainExpression',
        expression: { type: 'TSNonNullExpression', expression: { type: 'Identifier', name: 'x' } },
      },
    }
    expect(unwrapTsWrappers(node)).toEqual({ type: 'Identifier', name: 'x' })
  })

  it('is a no-op for a plain node', () => {
    const node = { type: 'Identifier', name: 'y' }
    expect(unwrapTsWrappers(node)).toBe(node)
  })
})
