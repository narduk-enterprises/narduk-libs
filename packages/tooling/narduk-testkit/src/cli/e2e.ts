import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import { runSeedAdminCommand } from '../e2e/admin-credential.js'
import { resolveFromCheckout, runE2eCommand } from '../playwright/e2e-runner.js'

const argv = process.argv.slice(2)

if (argv[0] === 'seed-admin') {
  process.exitCode = await runSeedAdminCommand(argv.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    error: (message) => console.error(message),
    log: (message) => console.log(message),
    wrangler: (args, options) => {
      const result = spawnSync('wrangler', [...args], {
        cwd: options.cwd,
        encoding: 'utf8',
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return {
        error: result.error,
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      }
    },
  })
} else {
  process.exitCode = runE2eCommand(argv, {
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
}
