import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEPENDABOT_MERGE_POLICY } from '../src/dependabot-merge-policy.js'

function dependency(name = 'happy-dom', type = 'patch', group = '') {
  return `- dependency-name: ${name}\n  dependency-type: direct:development\n  update-type: version-update:semver-${type}\n${group ? `  dependency-group: ${group}\n` : ''}`
}
function commit(metadata = dependency()) {
  return {
    sha: 'proved-head',
    author: { id: 49699333, login: 'dependabot[bot]', type: 'Bot' },
    committer: { id: 19864447, login: 'web-flow', type: 'User' },
    commit: {
      verification: { verified: true },
      message: `Bump dependency\n\n---\nupdated-dependencies:\n${metadata}...\n`,
    },
  }
}
function eligible(
  commits = [commit()],
  head = 'proved-head',
  branch = 'dependabot/npm_and_yarn/happy-dom-21.0.4',
) {
  const dir = mkdtempSync(join(tmpdir(), 'dependabot-policy-'))
  try {
    const filename = join(dir, 'commits.json')
    writeFileSync(filename, JSON.stringify(commits))
    const result = spawnSync('python3', ['-c', DEPENDABOT_MERGE_POLICY, head, branch, filename], {
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    return result.stdout.trim() === 'true'
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('verified Dependabot minor/patch policy', () => {
  it('accepts standalone fixes and a safe group with mixed minor/patch updates', () => {
    expect(eligible()).toBe(true)
    expect(
      eligible([commit(dependency('one', 'minor', 'safe') + dependency('two', 'patch', 'safe'))]),
    ).toBe(true)
  })
  it('rejects majors, unsupported metadata and unrelated groups', () => {
    expect(eligible([commit(dependency('one', 'major'))])).toBe(false)
    expect(eligible([commit(dependency('one', 'patch', 'other'))])).toBe(false)
    expect(eligible([commit(dependency('one') + dependency('two'))])).toBe(false)
    expect(eligible([commit('')])).toBe(false)
    expect(eligible([commit('- dependency-name: one\n')])).toBe(false)
  })
  it('rejects unsigned or mixed-author commits even when the head is a bot commit', () => {
    const unsigned = commit()
    unsigned.commit.verification.verified = false
    expect(eligible([unsigned])).toBe(false)
    const human = commit()
    human.author.id = 123
    human.author.login = 'human'
    expect(eligible([human, commit()])).toBe(false)
    const spoofed = commit()
    spoofed.author.id = 123
    expect(eligible([spoofed])).toBe(false)
  })
  it('rejects a human committer even with a verified bot author', () => {
    const human = commit()
    human.committer = { id: 123, login: 'human', type: 'User' }
    expect(eligible([human])).toBe(false)
    const spoofed = commit()
    spoofed.committer.id = 123
    expect(eligible([spoofed])).toBe(false)
    const missing = { ...commit(), committer: undefined }
    const dir = mkdtempSync(join(tmpdir(), 'dependabot-missing-committer-'))
    try {
      const filename = join(dir, 'commits.json')
      writeFileSync(filename, JSON.stringify([missing]))
      const result = spawnSync(
        'python3',
        [
          '-c',
          DEPENDABOT_MERGE_POLICY,
          'proved-head',
          'dependabot/npm_and_yarn/pkg-1.0.1',
          filename,
        ],
        { encoding: 'utf8' },
      )
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe('false')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('rejects stale heads, empty or oversized histories and other ecosystems', () => {
    expect(eligible([commit()], 'stale')).toBe(false)
    expect(eligible([])).toBe(false)
    expect(eligible(Array.from({ length: 101 }, () => commit()))).toBe(false)
    expect(eligible([commit()], 'proved-head', 'dependabot/github_actions/safe-x')).toBe(false)
  })
})
