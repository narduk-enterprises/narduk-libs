import { Linter, type Rule } from 'eslint'
import { describe, expect, it } from 'vitest'

import {
  classifyWorkerRuntimeFile,
  createModuleEvaluationAnalyzer,
  createWorkerRuntimeResolver,
  isWorkerRuntimeFile,
} from '../../src/rules/utils/cloudflare-runtime'

/** Manifest probe that answers from an in-memory set — no filesystem needed. */
function manifestAt(...roots: string[]) {
  const set = new Set(roots)
  return (directory: string) => set.has(directory)
}

describe('classifyWorkerRuntimeFile — the ~/workers/ checkout bug', () => {
  const hasManifest = manifestAt('/Users/dev/workers/my-app')

  it('does NOT classify an app page as Worker runtime just because an ANCESTOR dir is named workers', () => {
    // v1: `normalized.includes('/workers/')` on the absolute path made every
    // file in a checkout under ~/workers/ a Worker runtime file.
    const result = classifyWorkerRuntimeFile('/Users/dev/workers/my-app/app/pages/index.vue', {
      cwd: '/Users/dev/workers/my-app',
      hasManifest,
    })
    expect(result.isWorkerRuntime).toBe(false)
    expect(result.reason).toBe('not-worker')
    expect(result.projectRoot).toBe('/Users/dev/workers/my-app')
    expect(result.relativePath).toBe('app/pages/index.vue')
  })

  it('still classifies a real in-project workers/ dir as Worker runtime', () => {
    const result = classifyWorkerRuntimeFile(
      '/Users/dev/workers/my-app/workers/queue-consumer.ts',
      { cwd: '/Users/dev/workers/my-app', hasManifest },
    )
    expect(result.isWorkerRuntime).toBe(true)
    expect(result.reason).toBe('worker-dir-in-project')
  })

  it('resolves the project root by walking up to the nearest manifest', () => {
    const result = classifyWorkerRuntimeFile('/Users/dev/workers/my-app/server/api/users.post.ts', {
      cwd: '/Users/dev',
      hasManifest,
    })
    expect(result.projectRoot).toBe('/Users/dev/workers/my-app')
    expect(result.reason).toBe('nitro-server-dir')
  })
})

describe('classifyWorkerRuntimeFile — layout signals', () => {
  const options = { cwd: '/repo', hasManifest: manifestAt('/repo') }

  it.each([
    ['/repo/server/api/users.post.ts', 'nitro-server-dir'],
    ['/repo/server/plugins/warmup.ts', 'nitro-server-dir'],
    ['/repo/layers/admin/server/utils/db.ts', 'nitro-server-dir'],
    ['/repo/workers/consumer.ts', 'worker-dir-in-project'],
    ['/repo/functions/api/[[path]].ts', 'pages-functions-dir'],
    ['/repo/lib/cache.worker.ts', 'file-marker'],
    ['/repo/lib/render.server.ts', 'file-marker'],
  ])('%s -> %s', (filename, reason) => {
    const result = classifyWorkerRuntimeFile(filename, options)
    expect(result.isWorkerRuntime).toBe(true)
    expect(result.reason).toBe(reason)
  })

  it.each([
    '/repo/app/pages/index.vue',
    '/repo/app/composables/useThing.ts',
    '/repo/nuxt.config.ts',
    '/repo/scripts/build.mjs',
  ])('%s is not Worker runtime', (filename) => {
    expect(isWorkerRuntimeFile(filename, options)).toBe(false)
  })

  it('never classifies test or fixture files as Worker runtime', () => {
    for (const filename of [
      '/repo/server/api/users.post.test.ts',
      '/repo/tests/server/api/users.ts',
      '/repo/server/__fixtures__/handler.ts',
      '/repo/server/api/users.spec.ts',
    ]) {
      const result = classifyWorkerRuntimeFile(filename, options)
      expect(result.isWorkerRuntime).toBe(false)
      expect(result.reason).toBe('test-or-fixture')
    }
  })

  it('classifies relative filenames identically to absolute ones', () => {
    expect(isWorkerRuntimeFile('server/api/users.post.ts', options)).toBe(true)
    expect(isWorkerRuntimeFile('app/pages/index.vue', options)).toBe(false)
  })

  it('honours an explicit project-relative override prefix', () => {
    const result = classifyWorkerRuntimeFile('/repo/edge/handler.ts', {
      ...options,
      workerPathPrefixes: ['edge/'],
    })
    expect(result.isWorkerRuntime).toBe(true)
    expect(result.reason).toBe('explicit-glob')
  })

  it('refuses to guess for an absolute path with no resolvable project root', () => {
    const result = classifyWorkerRuntimeFile('/elsewhere/workers/thing.ts', {
      cwd: '/repo',
      hasManifest: manifestAt('/repo'),
    })
    expect(result.isWorkerRuntime).toBe(false)
    expect(result.reason).toBe('outside-project-root')
  })

  it('createWorkerRuntimeResolver memoizes manifest probes per instance', () => {
    let probes = 0
    const resolver = createWorkerRuntimeResolver({
      cwd: '/repo',
      hasManifest: (directory) => {
        probes += 1
        return directory === '/repo'
      },
    })
    resolver.isWorkerRuntime('/repo/server/api/a.post.ts')
    const afterFirst = probes
    resolver.isWorkerRuntime('/repo/server/api/a.post.ts')
    expect(probes).toBe(afterFirst)
    // A fresh resolver starts with a cold cache — no cross-run leakage.
    const fresh = createWorkerRuntimeResolver({ cwd: '/repo', hasManifest: manifestAt('/repo') })
    expect(fresh.isWorkerRuntime('/repo/server/api/a.post.ts')).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* Module-evaluation analyzer                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Run the analyzer over real parsed code and report which `new X()` /
 * `marker()` sites it considers module-evaluation reachable.
 */
function moduleEvalMarkers(code: string): string[] {
  const linter = new Linter()
  const found: string[] = []
  linter.verify(code, {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    plugins: {
      probe: {
        rules: {
          capture: {
            create(context: Rule.RuleContext): Rule.RuleListener {
              const analyzer = createModuleEvaluationAnalyzer(context.sourceCode)
              const record = (node: Rule.Node, label: string): void => {
                if (analyzer.isExecutedDuringModuleEvaluation(node)) found.push(label)
              }
              return {
                NewExpression(node) {
                  if (node.callee.type === 'Identifier') record(node, `new ${node.callee.name}`)
                },
                CallExpression(node) {
                  if (node.callee.type === 'Identifier' && node.callee.name.startsWith('marker')) {
                    record(node, node.callee.name)
                  }
                },
              }
            },
          },
        },
      },
    },
    rules: { 'probe/capture': 'error' },
  })
  return found
}

describe('createModuleEvaluationAnalyzer', () => {
  it('detects a plain module-scope construction', () => {
    expect(moduleEvalMarkers('const pool = new Pool()')).toEqual(['new Pool'])
  })

  it('detects callback-invoked module scope — arr.map(() => new Pool())', () => {
    // v1 missed this entirely: the arrow is neither immediately invoked nor
    // bound to a variable, so the analyzer concluded it never runs.
    expect(moduleEvalMarkers('const pools = [1, 2].map(() => new Pool())')).toEqual(['new Pool'])
  })

  it.each([
    ['forEach', 'const out = []; [1].forEach(() => { out.push(new Pool()) })'],
    ['flatMap', 'const p = [1].flatMap(() => [new Pool()])'],
    ['Array.from', 'const p = Array.from({ length: 2 }, () => new Pool())'],
    ['filter', 'const p = [1].filter(() => Boolean(new Pool()))'],
    ['sort', 'const p = [1, 2].sort(() => new Pool().compare())'],
  ])('detects eager %s callbacks', (_name, code) => {
    expect(moduleEvalMarkers(code)).toContain('new Pool')
  })

  it('detects a NAMED function passed to an eager callback method', () => {
    expect(
      moduleEvalMarkers('function make() { return new Pool() }\nconst p = [1].map(make)'),
    ).toEqual(['new Pool'])
  })

  it('detects a new Promise executor, which runs synchronously during construction (#887)', () => {
    expect(
      moduleEvalMarkers('const ready = new Promise((resolve) => { resolve(new Pool()) })'),
    ).toContain('new Pool')
    expect(
      moduleEvalMarkers(
        'function start(resolve) { resolve(new Pool()) }\nconst ready = new Promise(start)',
      ),
    ).toContain('new Pool')
  })

  it('does NOT flag a Promise executor that is itself deferred, or work its executor defers (#887)', () => {
    expect(
      moduleEvalMarkers('export function later() { return new Promise(() => new Pool()) }'),
    ).toEqual([])
    expect(
      moduleEvalMarkers('const ready = new Promise((resolve) => setTimeout(() => new Pool(), 0))'),
    ).not.toContain('new Pool')
    expect(moduleEvalMarkers('const p = new Promise.Custom(() => new Pool())')).not.toContain(
      'new Pool',
    )
  })

  it('does NOT flag deferred callbacks', () => {
    expect(moduleEvalMarkers('setTimeout(() => new Pool(), 0)')).toEqual([])
    expect(moduleEvalMarkers('queueMicrotask(() => { marker1() })')).toEqual([])
    expect(moduleEvalMarkers('Promise.resolve().then(() => new Pool())')).toEqual([])
    expect(moduleEvalMarkers('addEventListener("fetch", () => new Pool())')).toEqual([])
  })

  it('does NOT flag work inside an uninvoked handler', () => {
    expect(
      moduleEvalMarkers('export default defineEventHandler(() => { return new Pool() })'),
    ).toEqual([])
    expect(moduleEvalMarkers('export function getPool() { return new Pool() }')).toEqual([])
  })

  it('follows a directly invoked local factory', () => {
    expect(moduleEvalMarkers('function make() { return new Pool() }\nconst p = make()')).toEqual([
      'new Pool',
    ])
  })

  it('follows an IIFE', () => {
    expect(moduleEvalMarkers('const p = (() => new Pool())()')).toEqual(['new Pool'])
  })

  it('follows an invoked object method', () => {
    expect(
      moduleEvalMarkers('const db = { init() { return new Pool() } }\nconst p = db.init()'),
    ).toEqual(['new Pool'])
  })

  it('terminates on mutual recursion instead of hanging or poisoning the memo', () => {
    const code = `
      function a() { return b() }
      function b() { return a() }
      function c() { return new Pool() }
      a()
      c()
    `
    expect(moduleEvalMarkers(code)).toEqual(['new Pool'])
  })

  it('does not let a truncated recursion answer poison a later real answer', () => {
    // `helper` is reached first through the recursive pair (guard returns
    // false) and then genuinely invoked at module scope. The second answer
    // must win — v1 memoized the truncated `false` forever.
    const code = `
      function loop() { return helper() && loop() }
      function helper() { return new Pool() }
      helper()
    `
    expect(moduleEvalMarkers(code)).toEqual(['new Pool'])
  })

  it('gives every analyzer instance its own cache (no cross-file leakage)', () => {
    // Same source text twice through two separate analyzers must agree.
    const first = moduleEvalMarkers('const p = [1].map(() => new Pool())')
    const second = moduleEvalMarkers('const p = [1].map(() => new Pool())')
    expect(first).toEqual(second)
    expect(first).toEqual(['new Pool'])
  })
})
