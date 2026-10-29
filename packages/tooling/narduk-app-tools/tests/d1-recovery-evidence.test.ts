import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  preserveRecovery,
  probeRecoveryStore,
  runRecoveryEvidenceCommand,
} from '../src/d1-recovery-evidence.js'

const paths: string[] = []
function scratchDir(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  paths.push(root)
  return root
}
afterEach(() => {
  vi.unstubAllEnvs()
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})
const sha = 'a'.repeat(40)
const secret = 'c'.repeat(64) // Test-only S3 fixture, never a provider credential.

function fixture() {
  const root = scratchDir('promote-recovery-')
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const curl = join(bin, 'curl')
  writeFileSync(
    curl,
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const config = fs.readFileSync(0, 'utf8');
const arg = name => args[args.indexOf(name) + 1];
const base = process.env.FAKE_STORE;
fs.appendFileSync(path.join(base, 'requests'), JSON.stringify({ args, stdinAuth: config.includes(process.env.CI_ARTIFACTS_R2_SECRET_ACCESS_KEY) }) + '\\n');
if (process.env.STORE_MODE === 'fail') process.exit(22);
if (arg('--request') === 'PUT') fs.copyFileSync(arg('--upload-file'), path.join(base, 'stored.tar.gz'));
else {
  fs.copyFileSync(path.join(base, 'stored.tar.gz'), arg('--output'));
  if (process.env.STORE_MODE === 'corrupt') fs.appendFileSync(arg('--output'), 'corruption');
}
process.stdout.write(process.env.STORE_MODE === 'denied' ? '403' : '200');
`,
  )
  chmodSync(curl, 0o755)
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_REPOSITORY: 'narduk-enterprises/fixture-app',
    VERIFIED_SHA: sha,
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_STEP_SUMMARY: join(root, 'summary'),
    CI_ARTIFACTS_R2_ACCOUNT_ID: '1'.repeat(32),
    CI_ARTIFACTS_R2_ACCESS_KEY_ID: 'b'.repeat(32),
    CI_ARTIFACTS_R2_SECRET_ACCESS_KEY: secret,
    D1_RECOVERY_REQUIRED: 'false',
    FAKE_STORE: root,
  }
  const capture = (
    path: string,
    body = '{"timeTravelBookmark":"fixture-bookmark","schema":[],"migrationLedger":[]}\n',
  ) => {
    const file = join(root, path)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, body)
    return file
  }
  const run = (overrides: NodeJS.ProcessEnv = {}, probe = false) => {
    const merged = { ...env, ...overrides }
    for (const [key, value] of Object.entries(merged)) vi.stubEnv(key, value)
    try {
      const result = probe
        ? probeRecoveryStore({ env: merged })
        : preserveRecovery({ root, env: merged })
      return { status: 0, stdout: JSON.stringify(result), stderr: '' }
    } catch (error) {
      return {
        status: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'capture failed',
      }
    }
  }
  return { root, env, capture, run }
}

describe('D1 recovery preservation before promotion', () => {
  test('CLI refuses an implicit or malformed checkout instead of missing root evidence', () => {
    for (const args of [[], ['.'], ['--checkout'], ['--checkout', '--probe'], ['--other']]) {
      expect(() => runRecoveryEvidenceCommand(args)).toThrow('Usage:')
    }
    const f = fixture()
    vi.stubEnv('D1_RECOVERY_REQUIRED', 'false')
    expect(runRecoveryEvidenceCommand(['--checkout', f.root])).toEqual({
      status: 'not-required',
      files: 0,
    })
  })
  test('keeps every complete file from both hidden recovery roots with manifest and verified readback', () => {
    const f = fixture()
    const first = f.capture('apps/web/.narduk/recovery/d1/ESTATE.json')
    const second = f.capture('.narduk/recovery/d1/DB.json')
    const result = f.run({ D1_RECOVERY_REQUIRED: 'true' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout + result.stderr).not.toContain(secret)
    const receipt = JSON.parse(result.stdout) as { files: number; key: string; sha256: string }
    expect(receipt.key).toBe(`proof/narduk-enterprises/fixture-app/d1-recovery-${sha}-123-2.tar.gz`)
    expect(receipt.files).toBe(2)
    const restore = join(f.root, 'restore')
    mkdirSync(restore)
    execFileSync('tar', ['-xzf', join(f.root, 'stored.tar.gz'), '-C', restore])
    expect(readFileSync(join(restore, 'apps/web/.narduk/recovery/d1/ESTATE.json'))).toEqual(
      readFileSync(first),
    )
    expect(readFileSync(join(restore, '.narduk/recovery/d1/DB.json'))).toEqual(readFileSync(second))
    expect(
      JSON.parse(readFileSync(join(restore, 'd1-recovery-manifest.json'), 'utf8')),
    ).toMatchObject({
      schema: 'narduk-d1-recovery.v1',
      repository: f.env.GITHUB_REPOSITORY,
      sha,
      run: '123',
      attempt: '2',
    })
    const calls = readFileSync(join(f.root, 'requests'), 'utf8')
    expect(calls).not.toContain(secret)
    expect(
      calls
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line).stdinAuth),
    ).toEqual([true, true])
    expect(calls).toContain('aws:amz:auto:s3')
    expect(calls).toContain('If-None-Match: *')
    expect(readFileSync(join(f.root, 'summary'), 'utf8')).toContain(receipt.sha256)
  })

  test('a no-op migration needs neither evidence nor a store credential', () => {
    const f = fixture()
    const result = f.run({ CI_ARTIFACTS_R2_SECRET_ACCESS_KEY: '' })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ status: 'not-required', files: 0 })
    expect(existsSync(join(f.root, 'requests'))).toBe(false)
  })

  test('an explicit probe uses the same transport with a fixed tiny payload and a separate one-day key', () => {
    const f = fixture()
    const result = f.run({}, true)
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'probe-verified',
      key: `probe/narduk-enterprises/fixture-app/d1-recovery-${sha}-123-2.txt`,
      bytes: 34,
    })
    expect(readFileSync(join(f.root, 'stored.tar.gz'), 'utf8')).toBe(
      'narduk-d1-recovery-store-probe.v1\n',
    )
    expect(readFileSync(join(f.root, 'summary'), 'utf8')).toContain(
      'not a migration recovery archive',
    )
  })

  test('probe readback corruption is a failure', () => {
    const f = fixture()
    expect(f.run({ STORE_MODE: 'corrupt' }, true).status).toBe(1)
  })

  test('a pending apply cannot pass without its required recovery files', () => {
    const f = fixture()
    const result = f.run({ D1_RECOVERY_REQUIRED: 'true' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('no files exist; nothing promoted')
  })

  test.each(['fail', 'corrupt', 'denied'])(
    'a %s store response blocks promotion and preserves the original snapshot',
    (mode) => {
      const f = fixture()
      const original = f.capture('.narduk/recovery/d1/DB.json')
      const bytes = readFileSync(original)
      const result = f.run({ STORE_MODE: mode })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('nothing promoted')
      expect(result.stdout + result.stderr).not.toContain(secret)
      expect(readFileSync(original)).toEqual(bytes)
    },
  )

  test.each([
    { CI_ARTIFACTS_R2_SECRET_ACCESS_KEY: '' },
    { GITHUB_REPOSITORY: '../other' },
    { GITHUB_REPOSITORY: 'narduk-enterprises/Kelvin' },
    { VERIFIED_SHA: 'bad' },
  ])('missing credentials or invalid run identity fail before network: %j', (overrides) => {
    const f = fixture()
    f.capture('.narduk/recovery/d1/DB.json')
    expect(f.run(overrides).status).toBe(1)
    expect(existsSync(join(f.root, 'requests'))).toBe(false)
  })

  test('symlinked source files cannot add data outside the recovery capture', () => {
    const f = fixture()
    const external = f.capture('external.json')
    mkdirSync(join(f.root, '.narduk/recovery/d1'), { recursive: true })
    symlinkSync(external, join(f.root, '.narduk/recovery/d1/link.json'))
    expect(f.run().status).toBe(1)
    expect(existsSync(join(f.root, 'requests'))).toBe(false)
  })

  test('a symlinked ancestor cannot escape the checkout', () => {
    const f = fixture()
    const external = scratchDir('external-recovery-')
    mkdirSync(join(external, 'recovery/d1'), { recursive: true })
    writeFileSync(join(external, 'recovery/d1/DB.json'), '{}')
    symlinkSync(external, join(f.root, '.narduk'))
    expect(f.run().status).toBe(1)
    expect(existsSync(join(f.root, 'requests'))).toBe(false)
  })

  test('an oversized capture fails as incomplete rather than silently omitting recovery files', () => {
    const f = fixture()
    f.capture('.narduk/recovery/d1/DB.json', 'x'.repeat(16 * 1024 * 1024 + 1))
    expect(f.run().status).toBe(1)
    expect(existsSync(join(f.root, 'requests'))).toBe(false)
  })
})
