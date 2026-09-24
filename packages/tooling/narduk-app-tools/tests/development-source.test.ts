import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertCapturedInputs,
  captureDevelopmentSource,
  dependencyFingerprint,
  populateDevelopmentWorkspace,
} from '../src/development-source.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dev-source-'))
  roots.push(root)
  const checkout = join(root, 'author')
  mkdirSync(checkout)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: checkout, stdio: 'pipe' })
  git('init', '-q')
  writeFileSync(join(checkout, '.gitignore'), '.env\nnode_modules/\n.output/\nignored-input.json\n')
  writeFileSync(join(checkout, 'tracked.ts'), 'export const value = 1\n')
  writeFileSync(join(checkout, 'deleted.ts'), 'export const old = 1\n')
  writeFileSync(join(checkout, 'package.json'), '{"name":"fixture"}\n')
  writeFileSync(join(checkout, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  git('add', '.')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'base',
  )
  return { root, checkout, git, snapshot: join(root, 'snapshot'), workspace: join(root, 'build') }
}

describe('frozen local source and reusable workspace', () => {
  it('captures dirty edits, deletion, untracked source and modes without author outputs or secrets', () => {
    const f = fixture()
    writeFileSync(join(f.checkout, 'tracked.ts'), 'export const value = 2\n')
    rmSync(join(f.checkout, 'deleted.ts'))
    writeFileSync(join(f.checkout, 'new.ts'), 'export const newValue = 3\n')
    chmodSync(join(f.checkout, 'new.ts'), 0o755)
    writeFileSync(join(f.checkout, '.env'), 'NOT_A_REAL_SECRET=private\n')
    mkdirSync(join(f.checkout, '.output'))
    writeFileSync(join(f.checkout, '.output', 'server.js'), 'stale')
    const snapshot = captureDevelopmentSource(f.checkout, f.snapshot)
    expect(snapshot.entries.find((entry) => entry.path === 'deleted.ts')?.kind).toBe('deleted')
    expect(snapshot.entries.find((entry) => entry.path === 'new.ts')?.mode).toBe(0o755)
    expect(existsSync(join(f.snapshot, '.env'))).toBe(false)
    expect(existsSync(join(f.snapshot, '.output'))).toBe(false)
    populateDevelopmentWorkspace(snapshot, f.workspace)
    writeFileSync(join(f.checkout, 'tracked.ts'), 'later author edit')
    expect(readFileSync(join(f.workspace, 'tracked.ts'), 'utf8')).toContain('value = 2')
    expect(existsSync(join(f.workspace, 'deleted.ts'))).toBe(false)
    assertCapturedInputs(snapshot, f.workspace)
  })
  it('retries changed captures and bounds persistent author edits', () => {
    const f = fixture()
    let copies = 0
    const snapshot = captureDevelopmentSource(f.checkout, f.snapshot, {
      afterCopy: () => {
        if (copies++ === 0) writeFileSync(join(f.checkout, 'tracked.ts'), 'second revision')
      },
    })
    expect(copies).toBe(2)
    expect(readFileSync(join(snapshot.directory, 'tracked.ts'), 'utf8')).toBe('second revision')
    expect(() =>
      captureDevelopmentSource(f.checkout, join(f.root, 'unstable'), {
        attempts: 2,
        afterCopy: () => writeFileSync(join(f.checkout, 'tracked.ts'), String(++copies)),
      }),
    ).toThrow('pause edits briefly')
    expect(existsSync(join(f.root, 'unstable'))).toBe(false)
  })
  it('preserves internal symlinks and rejects external or uncaptured targets', () => {
    const f = fixture()
    symlinkSync('tracked.ts', join(f.checkout, 'internal.ts'))
    const snapshot = captureDevelopmentSource(f.checkout, f.snapshot)
    populateDevelopmentWorkspace(snapshot, f.workspace)
    expect(readFileSync(join(f.workspace, 'internal.ts'), 'utf8')).toContain('value = 1')
    writeFileSync(join(f.root, 'outside'), 'private outside')
    symlinkSync('../outside', join(f.checkout, 'external'))
    expect(() => captureDevelopmentSource(f.checkout, join(f.root, 'refused'))).toThrow('escapes')
    rmSync(join(f.checkout, 'external'))
    writeFileSync(join(f.checkout, 'ignored-input.json'), '{}')
    symlinkSync('ignored-input.json', join(f.checkout, 'missing-input'))
    expect(() => captureDevelopmentSource(f.checkout, join(f.root, 'refused'))).toThrow(
      'not captured',
    )
  })
  it('captures declared ignored inputs but never credential overrides', () => {
    const f = fixture()
    writeFileSync(join(f.checkout, 'ignored-input.json'), '{}')
    writeFileSync(join(f.checkout, '.env'), 'private')
    const snapshot = captureDevelopmentSource(f.checkout, f.snapshot, {
      additional: ['ignored-input.json'],
    })
    expect(snapshot.entries.some((entry) => entry.path === 'ignored-input.json')).toBe(true)
    expect(() =>
      captureDevelopmentSource(f.checkout, join(f.root, 'bad'), { additional: ['.env'] }),
    ).toThrow('excluded')
  })
  it('retains installed dependencies while removing stale source and generated files', () => {
    const f = fixture()
    const first = captureDevelopmentSource(f.checkout, f.snapshot)
    populateDevelopmentWorkspace(first, f.workspace)
    mkdirSync(join(f.workspace, 'node_modules'))
    writeFileSync(join(f.workspace, 'node_modules', 'warm'), 'keep')
    mkdirSync(join(f.workspace, '.output'))
    writeFileSync(join(f.workspace, '.output', 'stale'), 'remove')
    rmSync(join(f.checkout, 'tracked.ts'))
    const second = captureDevelopmentSource(f.checkout, join(f.root, 'second'))
    populateDevelopmentWorkspace(second, f.workspace)
    expect(existsSync(join(f.workspace, 'tracked.ts'))).toBe(false)
    expect(existsSync(join(f.workspace, '.output'))).toBe(false)
    expect(readFileSync(join(f.workspace, 'node_modules', 'warm'), 'utf8')).toBe('keep')
    expect(dependencyFingerprint(first, '10.33.4')).toBe(dependencyFingerprint(second, '10.33.4'))
    writeFileSync(join(f.checkout, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nsettings: {}\n')
    const third = captureDevelopmentSource(f.checkout, join(f.root, 'third'))
    expect(dependencyFingerprint(third, '10.33.4')).not.toBe(
      dependencyFingerprint(second, '10.33.4'),
    )
    expect(dependencyFingerprint(third, '10.33.4')).not.toBe(
      dependencyFingerprint(third, '10.34.0'),
    )
  })
  it('gives the workspace its own repository so repository-shaped checks can run', () => {
    const f = fixture()
    const first = captureDevelopmentSource(f.checkout, f.snapshot)
    populateDevelopmentWorkspace(first, f.workspace)
    mkdirSync(join(f.workspace, 'node_modules'), { recursive: true })
    writeFileSync(join(f.workspace, 'node_modules', 'warm'), 'keep')
    const inWorkspace = (...args: string[]) =>
      execFileSync('git', args, { cwd: f.workspace, encoding: 'utf8' }).trim()
    expect(inWorkspace('rev-parse', '--show-toplevel')).toBe(realpathSync(f.workspace))
    const listed = () =>
      inWorkspace('ls-files', '-co', '--exclude-standard').split('\n').filter(Boolean)
    expect(listed()).toContain('tracked.ts')
    expect(listed().some((path) => path.startsWith('node_modules/'))).toBe(false)
    expect(inWorkspace('status', '--porcelain')).toBe('')
    rmSync(join(f.checkout, 'tracked.ts'))
    writeFileSync(join(f.checkout, 'added.ts'), 'export const added = 1\n')
    const second = captureDevelopmentSource(f.checkout, join(f.root, 'second'))
    populateDevelopmentWorkspace(second, f.workspace)
    expect(listed()).toContain('added.ts')
    expect(listed()).not.toContain('tracked.ts')
    expect(inWorkspace('status', '--porcelain')).toBe('')
    expect(readFileSync(join(f.workspace, 'node_modules', 'warm'), 'utf8')).toBe('keep')
  })
  it('keeps warm dependencies out of the workspace repository without relying on app ignore rules', () => {
    const f = fixture()
    writeFileSync(join(f.checkout, '.gitignore'), '.env\n.output/\nignored-input.json\n')
    populateDevelopmentWorkspace(captureDevelopmentSource(f.checkout, f.snapshot), f.workspace)
    mkdirSync(join(f.workspace, 'apps/web/node_modules'), { recursive: true })
    writeFileSync(join(f.workspace, 'apps/web/node_modules', 'installed.js'), 'dependency')
    populateDevelopmentWorkspace(
      captureDevelopmentSource(f.checkout, join(f.root, 'second')),
      f.workspace,
    )
    const listed = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
      cwd: f.workspace,
      encoding: 'utf8',
    })
    expect(listed).not.toContain('node_modules')
    expect(listed).toContain('tracked.ts')
  })
  it('refuses modified captured inputs and inline registry credentials', () => {
    const f = fixture()
    const snapshot = captureDevelopmentSource(f.checkout, f.snapshot)
    populateDevelopmentWorkspace(snapshot, f.workspace)
    writeFileSync(join(f.workspace, 'tracked.ts'), 'build rewrote source')
    expect(() => assertCapturedInputs(snapshot, f.workspace)).toThrow('Captured source changed')
    writeFileSync(join(f.checkout, '.npmrc'), '//registry.example/:_authToken=fixture-secret\n')
    expect(() => captureDevelopmentSource(f.checkout, join(f.root, 'bad'))).toThrow(
      'Inline registry credentials',
    )
  })
})
