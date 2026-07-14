import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

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

function commandAvailable(command: string): boolean {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' })
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

export function runDoctor(rootDir = process.cwd()): DoctorReport {
  const requestedRoot = resolve(rootDir)
  const root =
    existsSync(join(requestedRoot, 'wrangler.json')) ||
    !existsSync(join(requestedRoot, 'apps', 'web', 'wrangler.json'))
      ? requestedRoot
      : resolve(requestedRoot, 'apps', 'web')
  const checks: DoctorCheck[] = []
  const packageJson = readPackage(root)
  checks.push(
    packageJson
      ? { name: 'package.json', status: 'pass' }
      : { detail: 'package.json is missing or invalid', name: 'package.json', status: 'fail' },
  )
  const wranglerPath = join(root, 'wrangler.json')
  checks.push(
    existsSync(wranglerPath)
      ? { name: 'wrangler.json', status: 'pass' }
      : { detail: 'wrangler.json is missing', name: 'wrangler.json', status: 'fail' },
  )
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
    commandAvailable('wrangler')
      ? { name: 'wrangler', status: 'pass' }
      : { detail: 'wrangler is not available on PATH', name: 'wrangler', status: 'warn' },
  )
  checks.push(
    commandAvailable('doppler')
      ? { name: 'doppler', status: 'pass' }
      : { detail: 'doppler is not available on PATH', name: 'doppler', status: 'warn' },
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
