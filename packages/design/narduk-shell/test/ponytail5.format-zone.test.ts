/* ponytail-5 repro (shell-src #1): an offset-less date-time follows the host zone. */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

import { instantOf } from '../src/format'

const formatPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'format.ts')

function run(tz: string): string {
  const code = `import { formatDate, formatDateTime } from ${JSON.stringify(formatPath)};
console.log(JSON.stringify([formatDate('2026-03-08T23:30:00', { timeZone: 'UTC', locale: 'en-US' }), formatDateTime('2026-03-08T23:30:00', { timeZone: 'UTC', locale: 'en-US' })]))`
  return execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    env: { ...process.env, TZ: tz },
  }).trim()
}

it('formats a zone-less date-time identically on a UTC host and a Chicago host', () => {
  expect(run('America/Chicago')).toBe(run('UTC'))
})

it('instantOf reads a zone-less date-time as UTC and refuses non-instants', () => {
  expect(instantOf('2026-03-08T23:30:00')).toBe(Date.UTC(2026, 2, 8, 23, 30))
  expect(instantOf('2026-03-08 23:30')).toBe(Date.UTC(2026, 2, 8, 23, 30))
  expect(instantOf('2026-03-08T23:30:00-05:00')).toBe(Date.UTC(2026, 2, 9, 4, 30))
  expect(instantOf(null)).toBeUndefined()
  expect(instantOf('not a date')).toBeUndefined()
  expect(instantOf(9e15)).toBeUndefined()
})
