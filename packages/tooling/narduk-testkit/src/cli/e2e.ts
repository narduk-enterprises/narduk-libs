import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import { resolveFromCheckout, runE2eCommand } from '../playwright/e2e-runner.js'

process.exitCode = runE2eCommand(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  error: (message) => console.error(message),
  exists: existsSync,
  log: (message) => console.log(message),
  nodePath: process.execPath,
  resolveFrom: resolveFromCheckout,
  spawn: (command, args, options) => {
    const result = spawnSync(command, [...args], {
      cwd: options.cwd,
      encoding: 'utf8',
      env: options.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      timeout: options.timeoutMs,
    })
    return { error: result.error, status: result.status, stderr: result.stderr ?? '' }
  },
})
