#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('Usage: narduk-testkit ui analyze [root]')
  process.exit(0)
}

if (args[0] !== 'ui' || args[1] !== 'analyze' || args.length > 3) {
  console.error('Usage: narduk-testkit ui analyze [root]')
  process.exit(1)
}

const scriptPath = fileURLToPath(new URL('../src/cli/ui-quality-analyze.ts', import.meta.url))
const runner = spawnSync(
  process.execPath,
  ['--import', import.meta.resolve('tsx/esm'), scriptPath, ...(args[2] ? [args[2]] : [])],
  {
    env: process.env,
    stdio: 'inherit',
  },
)

if (runner.error) {
  console.error(runner.error.message)
}

process.exit(runner.status ?? 1)
