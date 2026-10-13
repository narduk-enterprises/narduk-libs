#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const usage = [
  'Usage: narduk-testkit ui analyze [root]',
  '       narduk-testkit e2e check|setup|run [...]   (narduk-testkit e2e --help)',
].join('\n')

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(usage)
  process.exit(0)
}

let scriptPath
let scriptArgs
if (args[0] === 'ui' && args[1] === 'analyze' && args.length <= 3) {
  scriptPath = fileURLToPath(new URL('../dist/cli/ui-quality-analyze.js', import.meta.url))
  scriptArgs = args[2] ? [args[2]] : []
} else if (args[0] === 'e2e') {
  scriptPath = fileURLToPath(new URL('../dist/cli/e2e.js', import.meta.url))
  scriptArgs = args.slice(1)
} else {
  console.error(usage)
  process.exit(1)
}

const runner = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
  env: process.env,
  stdio: 'inherit',
})

if (runner.error) {
  console.error(runner.error.message)
}

process.exit(runner.status ?? 1)
