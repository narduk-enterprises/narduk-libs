#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const result = spawnSync(
  process.execPath,
  ['--import', import.meta.resolve('tsx/esm'), scriptPath, ...process.argv.slice(2)],
  { env: process.env, stdio: 'inherit' },
)

if (result.error) {
  console.error(`Could not start narduk-app: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
