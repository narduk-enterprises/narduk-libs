#!/usr/bin/env node
/**
 * Build dist/ when missing (fresh CI clone / workspace install) so dependents
 * like layers/core can run `nuxt prepare` before root postinstall runs.
 * Published tarballs already ship dist/; this exits immediately in that case.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const marker = path.join(pkgRoot, 'dist', 'index.js')
if (existsSync(marker)) {
  process.exit(0)
}

const result = spawnSync('pnpm', ['run', 'build'], {
  cwd: pkgRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exit(result.status ?? 1)
