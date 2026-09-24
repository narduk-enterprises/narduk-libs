import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { readJsonc, resolveWranglerConfigPath } from './deploy.js'
import {
  RATE_LIMIT_NAMESPACE_FIX,
  rateLimitBindings,
  rateLimitNamespaceIssues,
} from './rate-limit-namespaces.js'

export interface DoctorCheck {
  detail?: string
  name: string
  status: 'pass' | 'warn' | 'fail'
}

export interface DoctorReport {
  checks: DoctorCheck[]
  clean: boolean
  rootDir: string
}

function commandAvailable(command: string, args = ['--version']): boolean {
  const result = spawnSync(command, args, { stdio: 'ignore' })
  return !result.error && result.status === 0
}

function readPackage(rootDir: string): { scripts?: Record<string, string> } | null {
  const path = join(rootDir, 'package.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as { scripts?: Record<string, string> }
  } catch {
    return null
  }
}

/** `ratelimits[].namespace_id` is account-wide; refuse scaffold and reused ids (#433). */
export function rateLimitNamespaceCheck(wranglerPath: string): DoctorCheck {
  const name = 'rate-limit namespace ids'
  let config: unknown
  try {
    config = readJsonc<unknown>(wranglerPath)
  } catch (error) {
    return { detail: (error as Error).message, name, status: 'fail' }
  }
  const bindings = rateLimitBindings(config)
  if (bindings.length === 0) return { detail: 'no ratelimits bindings', name, status: 'pass' }
  const issues = rateLimitNamespaceIssues(config)
  return issues.length > 0
    ? { detail: `${issues.join('; ')}. Fix: ${RATE_LIMIT_NAMESPACE_FIX}.`, name, status: 'fail' }
    : { detail: `${bindings.length} binding(s), every namespace_id distinct`, name, status: 'pass' }
}

export function runDoctor(rootDir = process.cwd()): DoctorReport {
  const requestedRoot = resolve(rootDir)
  const nestedRoot = resolve(requestedRoot, 'apps', 'web')
  const root =
    resolveWranglerConfigPath(requestedRoot) || !resolveWranglerConfigPath(nestedRoot)
      ? requestedRoot
      : nestedRoot
  const checks: DoctorCheck[] = []
  const packageJson = readPackage(root)
  checks.push(
    packageJson
      ? { name: 'package.json', status: 'pass' }
      : { detail: 'package.json is missing or invalid', name: 'package.json', status: 'fail' },
  )
  const wranglerPath = resolveWranglerConfigPath(root)
  checks.push(
    wranglerPath
      ? { detail: wranglerPath, name: 'wrangler config', status: 'pass' }
      : {
          detail: 'wrangler.jsonc or wrangler.json is missing',
          name: 'wrangler config',
          status: 'fail',
        },
  )
  if (wranglerPath) checks.push(rateLimitNamespaceCheck(wranglerPath))
  checks.push(
    commandAvailable('node')
      ? { name: 'node', status: 'pass' }
      : { detail: 'Node is not available on PATH', name: 'node', status: 'fail' },
  )
  checks.push(
    commandAvailable('pnpm')
      ? { name: 'pnpm', status: 'pass' }
      : { detail: 'pnpm is not available on PATH', name: 'pnpm', status: 'fail' },
  )
  checks.push(
    commandAvailable('pnpm', ['exec', 'wrangler', '--version'])
      ? { name: 'wrangler (project)', status: 'pass' }
      : {
          detail: 'wrangler is not installed in the project dependency graph',
          name: 'wrangler (project)',
          status: 'warn',
        },
  )
  checks.push(
    commandAvailable('nvault', ['version'])
      ? { name: 'nvault', status: 'pass' }
      : { detail: 'nvault is not available on PATH', name: 'nvault', status: 'warn' },
  )
  const scripts = packageJson?.scripts ?? {}
  for (const name of ['cf:build', 'db:migrate:remote']) {
    checks.push(
      scripts[name]
        ? { name: `script:${name}`, status: 'pass' }
        : { detail: `package.json has no ${name} script`, name: `script:${name}`, status: 'warn' },
    )
  }
  return { checks, clean: checks.every((check) => check.status !== 'fail'), rootDir: root }
}

export function formatDoctorReport(report: DoctorReport): string {
  return [
    `Doctor report for ${report.rootDir}`,
    ...report.checks.map(
      (check) =>
        `${check.status.toUpperCase()} ${check.name}${check.detail ? `: ${check.detail}` : ''}`,
    ),
  ].join('\n')
}
