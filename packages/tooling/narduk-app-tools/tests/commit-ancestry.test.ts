import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { commitAncestry, landedAncestry, resolveAncestry } from '../src/commit-containment.js'

/** narduk-libs#1375: how a promote candidate stands against the live commit. */
describe('commitAncestry, against a real repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ancestry-'))
  const git = (...args: string[]): string => {
    const run = spawnSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.test',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.test',
      },
    })
    if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`)
    return run.stdout.trim()
  }
  git('init', '-q', '-b', 'main')
  git('commit', '-q', '--allow-empty', '-m', 'root')
  const parent = git('rev-parse', 'HEAD')
  git('commit', '-q', '--allow-empty', '-m', 'child')
  const child = git('rev-parse', 'HEAD')
  git('checkout', '-q', '-b', 'side', parent)
  git('commit', '-q', '--allow-empty', '-m', 'side')
  const side = git('rev-parse', 'HEAD')

  it('a strict ancestor of the live commit is an ancestor (the gonogo order)', () => {
    expect(commitAncestry(dir, parent, child)).toBe('ancestor')
  })
  it('the live commit itself is equal', () => {
    expect(commitAncestry(dir, child, child)).toBe('equal')
  })
  it('a commit that contains the live one is a descendant', () => {
    expect(commitAncestry(dir, child, parent)).toBe('descendant')
  })
  it('commits on separate lines are diverged', () => {
    expect(commitAncestry(dir, side, child)).toBe('diverged')
  })
  it('a commit the checkout lacks is unknown, never a guess', () => {
    expect(commitAncestry(dir, 'f'.repeat(40), child)).toBe('unknown')
  })
  it('a short SHA resolves to the same answer as a full one', () => {
    expect(commitAncestry(dir, parent.slice(0, 10), child)).toBe('ancestor')
    expect(commitAncestry(dir, child, child.slice(0, 10))).toBe('equal')
  })
})

describe('landedAncestry, for a shallow checkout that lacks the objects', () => {
  const answer =
    (status: unknown) =>
    (path: string): unknown => {
      expect(path).toBe(`compare/${'a'.repeat(40)}...${'b'.repeat(40)}?per_page=1`)
      return status === undefined ? null : { status }
    }
  const candidate = 'a'.repeat(40)
  const live = 'b'.repeat(40)

  it.each([
    ['ahead', 'ancestor'],
    ['behind', 'descendant'],
    ['identical', 'equal'],
    ['diverged', 'diverged'],
    ['something-new', 'unknown'],
    [undefined, 'unknown'],
  ])('compare status %s is %s', (status, expected) => {
    expect(landedAncestry(candidate, live, answer(status))).toBe(expected)
  })
})

describe('resolveAncestry', () => {
  const candidate = 'a'.repeat(40)
  const live = 'b'.repeat(40)

  it('asks GitHub only when local git cannot answer', () => {
    let asked = 0
    const github = (): unknown => {
      asked += 1
      return { status: 'ahead' }
    }
    const missing = () => ({ status: 1, stdout: '' })
    expect(resolveAncestry('/nowhere', candidate, live, { git: missing, github })).toBe('ancestor')
    expect(asked).toBe(1)

    asked = 0
    const present = (args: string[]) =>
      args[0] === 'merge-base' ? { status: 0, stdout: '' } : { status: 0, stdout: args[1] ?? 'x' }
    expect(resolveAncestry('/nowhere', candidate, live, { git: present, github })).toBe('ancestor')
    expect(asked).toBe(0)
  })

  it('refuses a tag that is not a hex SHA before it reaches argv or a URL', () => {
    const github = (): unknown => {
      throw new Error('must not be asked')
    }
    expect(resolveAncestry('/nowhere', '--upload-pack=x', live, { github })).toBe('unknown')
    expect(resolveAncestry('/nowhere', candidate, 'main; rm', { github })).toBe('unknown')
  })

  it('is unknown when neither git nor GitHub can answer', () => {
    expect(
      resolveAncestry('/nowhere', candidate, live, {
        git: () => ({ status: 1, stdout: '' }),
        github: () => null,
      }),
    ).toBe('unknown')
  })
})
