import { spawnSync } from 'node:child_process'

export interface DopplerSecretOptions {
  config: string
  project: string
}

export interface DopplerResult {
  ok: boolean
  value?: string
  error?: string
}

export function readDopplerSecret(key: string, options: DopplerSecretOptions): DopplerResult {
  const child = spawnSync(
    'doppler',
    ['secrets', 'get', key, '--project', options.project, '--config', options.config, '--plain'],
    {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (child.error) return { error: child.error.message, ok: false }
  if (child.status !== 0) {
    return {
      error: (child.stderr || `doppler exited with status ${child.status ?? 'unknown'}`).trim(),
      ok: false,
    }
  }
  const value = (child.stdout || '').trim()
  return value
    ? { ok: true, value }
    : { error: `Doppler returned an empty value for ${key}`, ok: false }
}

export function assertDopplerCliAvailable(): void {
  const result = spawnSync('doppler', ['--version'], { stdio: 'ignore' })
  if (result.error || result.status !== 0) {
    throw new Error(
      'Doppler CLI not found. Install it, log in, and configure the project before running this command.',
    )
  }
}
