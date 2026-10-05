import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveAppInfo } from '../../src/foundation/evaluate.js'
import { makeTempRepo, writeJson } from './helpers.js'

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function checkout(origin: string): string {
  const root = makeTempRepo()
  roots.push(root)
  vi.stubEnv('GITHUB_REPOSITORY', undefined)
  writeJson(root, 'package.json', { name: 'fixture-app' })
  execFileSync('git', ['init', '--quiet', root])
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: root })
  return root
}

describe('adoption report repository identity', () => {
  it.each([
    'git@github.com:narduk-enterprises/float-forecast.git',
    'https://github.com/narduk-enterprises/float-forecast.git',
    'ssh://git@github.com/narduk-enterprises/float-forecast.git',
    'https://github.com/narduk-enterprises/float-forecast',
  ])('infers a missing repository from origin %s', (origin) => {
    expect(resolveAppInfo(checkout(origin)).repo).toBe('narduk-enterprises/float-forecast')
  })

  it('uses a declared package repository before origin', () => {
    const root = checkout('https://github.com/narduk-enterprises/float-forecast.git')
    writeJson(root, 'package.json', {
      repository: { type: 'git', url: 'git+https://github.com/narduk-enterprises/declared.git' },
    })
    expect(resolveAppInfo(root).repo).toBe('narduk-enterprises/declared')
  })

  it('preserves explicit, CI and app-config identity precedence', () => {
    const root = checkout('https://github.com/narduk-enterprises/float-forecast.git')
    writeJson(root, 'Config/cloudflare-app.json', {
      product: { repository: 'narduk-enterprises/configured' },
    })
    expect(resolveAppInfo(root).repo).toBe('narduk-enterprises/configured')
    vi.stubEnv('GITHUB_REPOSITORY', 'narduk-enterprises/ci')
    expect(resolveAppInfo(root).repo).toBe('narduk-enterprises/ci')
    expect(resolveAppInfo(root, { repo: 'narduk-enterprises/explicit' }).repo).toBe(
      'narduk-enterprises/explicit',
    )
  })

  it.each(['https://example.com/owner/repo.git', 'https://github.com/owner', 'invalid'])(
    'keeps unknown when origin cannot identify a GitHub repository: %s',
    (origin) => {
      expect(resolveAppInfo(checkout(origin)).repo).toBe('unknown/unknown')
    },
  )
})
