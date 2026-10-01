import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EXIT_LINT_FAILURE, EXIT_OK, EXIT_USAGE, runNardukStylelint } from '../stylelint-budget.mjs'

function fixture(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'narduk-stylelint-'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  writeFileSync(
    join(dir, 'stylelint.config.mjs'),
    `import config from '${join(import.meta.dirname, '..', 'index.mjs')}'\nexport default config\n`,
  )
  return dir
}

async function run(dir: string, argv: string[] = []) {
  const out: string[] = []
  const err: string[] = []
  const code = await runNardukStylelint(argv, {
    cwd: dir,
    log: (line) => out.push(line),
    logError: (line) => err.push(line),
  })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

const WARNING = '.x { z-index: 1; }\n'
const CLEAN = '.x { z-index: var(--ns-z-dropdown); }\n'

describe('narduk-stylelint is strict: 0 errors, 0 warnings', () => {
  it('passes a clean tree', async () => {
    const dir = fixture({ 'ok.css': CLEAN })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('0 error(s), 0 warning(s)')
  })

  it('fails a single warning with no budget file at all', async () => {
    const dir = fixture({ 'bad.css': WARNING })
    const result = await run(dir, ['bad.css'])
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.out).toContain('0 error(s), 1 warning(s)')
    expect(result.err).toContain('narduk/no-raw-z-index: 1 warning(s)')
    expect(result.err).toContain('any warning fails')
  })

  it('fails a single warning under an empty strict budget, locally and in CI mode', async () => {
    const dir = fixture({
      'bad.css': WARNING,
      'stylelint-budget.json': JSON.stringify({ strict: true, rules: {}, files: {} }),
    })
    expect((await run(dir, ['bad.css'])).code).toBe(EXIT_LINT_FAILURE)
    expect((await run(dir, ['bad.css', '--ci'])).code).toBe(EXIT_LINT_FAILURE)
    expect((await run(dir, ['bad.css', '--local'])).code).toBe(EXIT_LINT_FAILURE)
  })

  it('fails on an error even with no warnings', async () => {
    const dir = fixture({ 'broken.css': '.x { color: red;\n' })
    const result = await run(dir, ['broken.css'])
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.out).toMatch(/1 error\(s\), 0 warning\(s\)/u)
  })

  it('does not lint Vue SFCs when no paths are passed', async () => {
    const dir = fixture({
      'ok.css': CLEAN,
      'broken.vue':
        '<script setup>\nconst computed = 1\n</script>\n<template><div /></template>\n<style>\n.x { z-index: 1; }\n</style>\n',
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(`${result.out}${result.err}`).not.toMatch(/CssSyntaxError|broken\.vue/u)
  })
})

describe('a budget file that still allows warnings', () => {
  const ENTRIES = JSON.stringify(
    { strict: true, rules: { 'narduk/no-raw-z-index': 1 }, files: { 'bad.css': 1 } },
    null,
    2,
  )

  it('no longer permits the warnings it covers, and says what to do', async () => {
    const dir = fixture({ 'bad.css': WARNING, 'stylelint-budget.json': ENTRIES })
    const result = await run(dir, ['bad.css', '--ci'])
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('stylelint-budget.json still allows warnings')
    expect(result.err).toContain('narduk/no-raw-z-index (1)')
    expect(result.err).toContain('bad.css (1)')
    expect(result.err).toContain('fix those warnings, delete the entries')
  })

  it('fails even when the tree is clean', async () => {
    const dir = fixture({ 'ok.css': CLEAN, 'stylelint-budget.json': ENTRIES })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('still allows warnings')
  })

  it('never rewrites the file', async () => {
    for (const source of [CLEAN, WARNING]) {
      const dir = fixture({ 'bad.css': source, 'stylelint-budget.json': ENTRIES })
      await run(dir, ['bad.css'])
      await run(dir, ['bad.css', '--local'])
      expect(readFileSync(join(dir, 'stylelint-budget.json'), 'utf8')).toBe(ENTRIES)
    }
  })

  it('passes with a notice when the file allows nothing', async () => {
    const dir = fixture({
      'ok.css': CLEAN,
      'stylelint-budget.json': JSON.stringify({ strict: true, rules: {}, files: {} }),
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('obsolete')
  })
})

describe('usage errors', () => {
  it('exits 2 on an unreadable budget file', async () => {
    const dir = fixture({ 'ok.css': CLEAN, 'stylelint-budget.json': '{ nope' })
    expect((await run(dir)).code).toBe(EXIT_USAGE)
  })

  it('exits 2 on --accept-new-rules and on unknown flags', async () => {
    const dir = fixture({ 'ok.css': CLEAN })
    const accept = await run(dir, ['--accept-new-rules'])
    expect(accept.code).toBe(EXIT_USAGE)
    expect(accept.err).toContain('removed')
    expect((await run(dir, ['--wat'])).code).toBe(EXIT_USAGE)
  })
})
