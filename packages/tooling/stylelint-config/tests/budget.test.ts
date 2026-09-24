import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EXIT_LINT_FAILURE, EXIT_OK, runNardukStylelint } from '../stylelint-budget.mjs'

function fixture(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'narduk-stylelint-'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  writeFileSync(
    join(dir, 'stylelint.config.mjs'),
    `import config from '${join(import.meta.dirname, '..', 'index.mjs')}'\nexport default config\n`,
  )
  return dir
}

describe('narduk-stylelint budget', () => {
  it('fails a strict budget when a fixture warning has no entry', async () => {
    const dir = fixture({
      'bad.css': '.x { z-index: 1; }\n',
      'stylelint-budget.json': JSON.stringify({ strict: true, rules: {}, files: {} }),
    })
    const logs: string[] = []
    const code = await runNardukStylelint(['bad.css', '--no-write'], {
      cwd: dir,
      env: { CI: 'true' },
      log: (line) => logs.push(line),
      logError: (line) => logs.push(line),
    })
    expect(code).toBe(EXIT_LINT_FAILURE)
    expect(logs.join('\n')).toMatch(/unbudgeted \(rule\): narduk\/no-raw-z-index/u)
  })

  it('passes when the warning is inside the recorded per-rule and per-file budget', async () => {
    const dir = fixture({
      'bad.css': '.x { z-index: 1; }\n',
      'stylelint-budget.json': JSON.stringify({
        strict: true,
        rules: { 'narduk/no-raw-z-index': 1 },
        files: { 'bad.css': 1 },
      }),
    })
    const silent = () => {
      /* budget path should stay quiet */
    }
    const code = await runNardukStylelint(['bad.css', '--ci'], {
      cwd: dir,
      env: { CI: 'true' },
      log: silent,
      logError: silent,
    })
    expect(code).toBe(EXIT_OK)
  })

  it('does not lint Vue SFCs when no paths are passed', async () => {
    const dir = fixture({
      'ok.css': '.stack { z-index: var(--ns-z-dropdown); }\n',
      'broken.vue':
        '<script setup>\nconst computed = 1\n</script>\n<template><div /></template>\n<style>\n.x { z-index: 1; }\n</style>\n',
      'stylelint-budget.json': JSON.stringify({ strict: true, rules: {}, files: {} }),
    })
    const logs: string[] = []
    const code = await runNardukStylelint(['--no-write'], {
      cwd: dir,
      env: { CI: 'true' },
      log: (line) => logs.push(line),
      logError: (line) => logs.push(line),
    })
    expect(code).toBe(EXIT_OK)
    expect(logs.join('\n')).not.toMatch(/CssSyntaxError|broken\.vue/u)
  })
})
