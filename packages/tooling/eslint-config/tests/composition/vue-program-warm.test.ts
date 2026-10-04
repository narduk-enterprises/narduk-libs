/**
 * narduk-libs#1393: a run that lints several `.vue` files opens them all in the
 * type-aware program before the type-aware rules start, so the program (and its
 * type checker) is built once instead of once per file.
 *
 * The parser wrapper is exercised against a stub `vue-eslint-parser`, since what
 * matters here is which files reach the real parser and with which options; the
 * speed-up itself is measured in the package PR, against a real app.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped resolver output
type FlatConfig = Record<string, any>

interface Parser {
  meta?: unknown
  parseForESLint: (code: string, options?: Record<string, unknown>) => unknown
}

interface WarmModule {
  WARM_AFTER_FILES: number
  listVueFiles: (rootDir: string) => string[]
  createProgramWarmingVueParser: (inner: Parser, options: { appRootDir: string }) => Parser
}

interface AppConfigModule {
  createAppLintConfig: (options: Record<string, unknown>) => FlatConfig[]
}

let warm: WarmModule
let appConfig: AppConfigModule

beforeAll(async () => {
  warm = (await import(
    new URL('../../configs/vue-program-warm.mjs', import.meta.url).href
  )) as WarmModule
  appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule
})

const typeAware = { projectService: true, extraFileExtensions: ['.vue'] }

function makeInner() {
  const parsed: Array<{ code: string; filePath: string }> = []
  return {
    parsed,
    meta: { name: 'vue-eslint-parser' },
    parseForESLint: vi.fn((code: string, options?: Record<string, unknown>) => {
      parsed.push({ code, filePath: String(options?.filePath) })
      return { ast: {} }
    }),
  }
}

describe('vue program warming parser', () => {
  let root: string
  const files: string[] = []

  beforeEach(() => {
    delete process.env.NARDUK_LINT_VUE_PROGRAM_WARM
    root = mkdtempSync(join(tmpdir(), 'vue-warm-'))
    mkdirSync(join(root, 'app/components'), { recursive: true })
    mkdirSync(join(root, 'node_modules/pkg'), { recursive: true })
    mkdirSync(join(root, '.nuxt'), { recursive: true })
    files.length = 0
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const file = join(root, 'app/components', `${name}.vue`)
      writeFileSync(file, `<script setup lang="ts">// ${name}</script>`)
      files.push(file)
    }
    writeFileSync(join(root, 'node_modules/pkg/Skip.vue'), '<script></script>')
    writeFileSync(join(root, '.nuxt/Skip.vue'), '<script></script>')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    delete process.env.NARDUK_LINT_VUE_PROGRAM_WARM
  })

  it('lists app .vue files and skips node_modules and dot directories', () => {
    expect(warm.listVueFiles(root).sort()).toEqual([...files].sort())
  })

  it('does nothing until a run has parsed more than the threshold of distinct files', () => {
    const inner = makeInner()
    const parser = warm.createProgramWarmingVueParser(inner, { appRootDir: root })

    for (const file of files.slice(0, warm.WARM_AFTER_FILES)) {
      parser.parseForESLint('code', { ...typeAware, filePath: file })
    }

    expect(inner.parsed.map((entry) => entry.filePath)).toEqual(
      files.slice(0, warm.WARM_AFTER_FILES),
    )
  })

  it('opens every other .vue file once, with the run’s own parser options, then parses the current file', () => {
    const inner = makeInner()
    const parser = warm.createProgramWarmingVueParser(inner, { appRootDir: root })

    for (const file of files.slice(0, warm.WARM_AFTER_FILES + 1)) {
      parser.parseForESLint('code', { ...typeAware, filePath: file })
    }

    const opened = inner.parsed.map((entry) => entry.filePath)
    // The first files were parsed as they arrived, the rest opened by the pass,
    // and the file that started the pass is parsed last, exactly once.
    expect(opened.slice(0, warm.WARM_AFTER_FILES)).toEqual(files.slice(0, warm.WARM_AFTER_FILES))
    expect(opened.slice(warm.WARM_AFTER_FILES, -1).sort()).toEqual(
      files.slice(warm.WARM_AFTER_FILES + 1).sort(),
    )
    expect(opened.at(-1)).toBe(files[warm.WARM_AFTER_FILES])
    expect(new Set(opened).size).toBe(files.length)

    const warmedCall = inner.parseForESLint.mock.calls.find(
      ([code]) => typeof code === 'string' && code.includes('// F'),
    )
    expect(warmedCall?.[1]).toMatchObject(typeAware)
  })

  it('runs the pass once', () => {
    const inner = makeInner()
    const parser = warm.createProgramWarmingVueParser(inner, { appRootDir: root })

    for (const file of files) {
      parser.parseForESLint('code', { ...typeAware, filePath: file })
    }
    const afterRun = inner.parsed.length
    parser.parseForESLint('code', { ...typeAware, filePath: files[0] })

    // Each file is parsed when the run reaches it; the two the pass opened
    // ahead of the run are parsed a second time then. Nothing repeats the pass.
    expect(afterRun).toBe(files.length + (files.length - warm.WARM_AFTER_FILES - 1))
    expect(inner.parsed.length).toBe(afterRun + 1)
  })

  it('leaves a parse that asks for no type information alone', () => {
    const inner = makeInner()
    const parser = warm.createProgramWarmingVueParser(inner, { appRootDir: root })

    for (const file of files) {
      parser.parseForESLint('code', { filePath: file })
    }

    expect(inner.parsed).toHaveLength(files.length)
  })

  it('switches off with NARDUK_LINT_VUE_PROGRAM_WARM=0', () => {
    process.env.NARDUK_LINT_VUE_PROGRAM_WARM = '0'
    const inner = makeInner()
    const parser = warm.createProgramWarmingVueParser(inner, { appRootDir: root })

    for (const file of files) {
      parser.parseForESLint('code', { ...typeAware, filePath: file })
    }

    expect(inner.parsed).toHaveLength(files.length)
  })

  it('keeps going when a pre-opened file does not parse, and still parses the current one', () => {
    const inner = makeInner()
    inner.parseForESLint.mockImplementation((code: string, options?: Record<string, unknown>) => {
      if (code.includes('// F')) {
        throw new Error('not in the project')
      }
      inner.parsed.push({ code, filePath: String(options?.filePath) })
      return { ast: {} }
    })
    const parser = warm.createProgramWarmingVueParser(inner, { appRootDir: root })

    for (const file of files.slice(0, warm.WARM_AFTER_FILES + 1)) {
      parser.parseForESLint('code', { ...typeAware, filePath: file })
    }

    expect(inner.parsed.at(-1)?.filePath).toBe(files[warm.WARM_AFTER_FILES])
  })

  it('exposes the inner parser’s meta so ESLint caches it as the same parser', () => {
    const inner = makeInner()
    const parser = warm.createProgramWarmingVueParser(inner, { appRootDir: root })
    expect(parser.meta).toBe(inner.meta)
  })
})

describe('createAppLintConfig wires the warming parser last', () => {
  it('appends one .vue entry after the app’s own overrides', () => {
    const override = { name: 'app/override', files: ['**/*.vue'], rules: {} }
    const configs: FlatConfig[] = appConfig.createAppLintConfig({
      withNuxt: (...entries: FlatConfig[]) => entries,
      capabilityPacks: ['correctness'],
      appRootDir: '/app',
      extraOverrides: [override],
    })

    const last = configs.at(-1)
    expect(last?.name).toBe('narduk/vue-program-warm')
    expect(last?.files).toEqual(['**/*.vue'])
    expect(typeof last?.languageOptions.parser.parseForESLint).toBe('function')
    expect(configs.filter((config) => config.name === 'narduk/vue-program-warm')).toHaveLength(1)
    expect(configs.indexOf(override)).toBeLessThan(configs.length - 1)
  })

  it('adds nothing without an app root', () => {
    const configs: FlatConfig[] = appConfig.createAppLintConfig({
      withNuxt: (...entries: FlatConfig[]) => entries,
      capabilityPacks: ['correctness'],
      appRootDir: '',
    })
    expect(configs.some((config) => config.name === 'narduk/vue-program-warm')).toBe(false)
  })
})
