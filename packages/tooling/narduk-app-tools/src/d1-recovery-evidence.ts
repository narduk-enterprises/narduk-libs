import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

const ROOTS = ['apps/web/.narduk/recovery/d1', '.narduk/recovery/d1']
const MAX_BYTES = 16 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
const digest = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** Complete tool-produced recovery files; no application rows or credential reads. */
function recoveryFiles(root: string) {
  const files: Array<{ path: string; bytes: number; sha256: string }> = []
  let total = 0
  for (const directory of ROOTS) {
    const absolute = join(root, directory)
    let stat
    try {
      stat = lstatSync(absolute)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw new Error('D1 recovery directory is unreadable', { cause: error })
    }
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      realpathSync(absolute) !== join(realpathSync(root), directory)
    ) {
      throw new Error('D1 recovery directory must be a real directory inside this checkout')
    }
    for (const name of readdirSync(absolute).sort()) {
      const path = `${directory}/${name}`
      const entry = lstatSync(join(root, path))
      if (!/^[\w.-]+\.json$/u.test(name) || !entry.isFile() || entry.isSymbolicLink()) {
        throw new Error('D1 recovery contains an unexpected file; refusing partial evidence')
      }
      total += entry.size
      if (files.length >= 64 || total > MAX_BYTES)
        throw new Error('D1 recovery exceeds the complete capture budget')
      files.push({ path, bytes: entry.size, sha256: digest(readFileSync(join(root, path))) })
    }
  }
  return files
}

/** curl owns AWS SigV4; credentials travel on stdin, never argv, URLs or logs. */
interface TransferOptions {
  method: 'GET' | 'PUT'
  url: string
  file?: string
  output: string
  sha256: string
  access: string
  secret: string
}

function transfer({ method, url, file, output, sha256, access, secret }: TransferOptions) {
  const args = [
    '--disable',
    '--silent',
    '--show-error',
    '--fail',
    '--proto',
    '=https',
    '--connect-timeout',
    '10',
    '--max-time',
    '60',
    '--max-filesize',
    String(MAX_ARCHIVE_BYTES),
    '--aws-sigv4',
    'aws:amz:auto:s3',
    '--config',
    '-',
    '--request',
    method,
    '--header',
    `x-amz-content-sha256: ${sha256}`,
    '--output',
    output,
    '--write-out',
    '%{http_code}',
  ]
  if (method === 'PUT') {
    if (!file) throw new Error('D1 recovery PUT requires a complete archive')
    args.push('--header', 'If-None-Match: *', '--upload-file', file)
  }
  args.push(url)
  let status
  try {
    status = execFileSync('curl', args, {
      input: `user = "${access}:${secret}"\n`,
      encoding: 'utf8',
      timeout: 65_000,
      maxBuffer: 4096,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    // Neither an S3 response nor a subprocess error is safe to dump with credentials in scope.
    throw new Error(`D1 recovery ${method} failed; nothing promoted`)
  }
  if (status !== '200')
    throw new Error(`D1 recovery ${method} answered HTTP ${status}; nothing promoted`)
}

function storeContext(env: NodeJS.ProcessEnv) {
  const repository = env.GITHUB_REPOSITORY ?? ''
  const sha = env.VERIFIED_SHA ?? ''
  const run = env.GITHUB_RUN_ID ?? ''
  const attempt = env.GITHUB_RUN_ATTEMPT ?? ''
  if (
    !/^[a-zA-Z\d][\w.-]*\/[a-zA-Z\d][\w.-]*$/u.test(repository) ||
    !/^[a-f0-9]{40}$/u.test(sha) ||
    !/^[1-9]\d*$/u.test(run) ||
    !/^[1-9]\d*$/u.test(attempt)
  ) {
    throw new Error('D1 recovery run identity is missing or malformed; nothing promoted')
  }
  const account = env.CI_ARTIFACTS_R2_ACCOUNT_ID ?? ''
  const access = env.CI_ARTIFACTS_R2_ACCESS_KEY_ID ?? ''
  const secret = env.CI_ARTIFACTS_R2_SECRET_ACCESS_KEY ?? ''
  if (
    !/^[a-f0-9]{32}$/u.test(account) ||
    !/^[a-f0-9]{32}$/u.test(access) ||
    !/^[a-f0-9]{64}$/u.test(secret)
  ) {
    throw new Error(
      'D1 recovery requires the existing CI artifact store credentials; nothing promoted',
    )
  }
  return { repository, sha, run, attempt, account, access, secret }
}

function preserveObject({
  context,
  file,
  key,
  scratch,
}: {
  context: ReturnType<typeof storeContext>
  file: string
  key: string
  scratch: string
}) {
  const bytes = readFileSync(file)
  if (bytes.length > MAX_ARCHIVE_BYTES)
    throw new Error('D1 recovery archive exceeds the transfer budget')
  const sha256 = digest(bytes)
  const { account, access, secret } = context
  const url = `https://${account}.r2.cloudflarestorage.com/narduk-ci-artifacts/${key}`
  transfer({
    method: 'PUT',
    url,
    file,
    output: join(scratch, 'put-response'),
    sha256,
    access,
    secret,
  })
  const restored = join(scratch, 'readback')
  transfer({ method: 'GET', url, output: restored, sha256: digest(''), access, secret })
  if (!bytes.equals(readFileSync(restored)))
    throw new Error('D1 recovery readback differs from the complete archive; nothing promoted')
  return { bucket: 'narduk-ci-artifacts', key, sha256, bytes: bytes.length }
}

export function preserveRecovery({
  root,
  env = process.env,
}: {
  root: string
  env?: NodeJS.ProcessEnv
}) {
  const files = recoveryFiles(root)
  if (!files.length) {
    if (env.D1_RECOVERY_REQUIRED === 'true')
      throw new Error(
        'D1 migration required recovery capture, but no files exist; nothing promoted',
      )
    return { status: 'not-required', files: 0 }
  }
  const context = storeContext(env)
  const { repository, sha, run, attempt } = context
  const key = `proof/${repository}/d1-recovery-${sha}-${run}-${attempt}.tar.gz`
  const scratch = mkdtempSync(join(tmpdir(), 'd1-recovery-preserve-'))
  try {
    const manifest = { schema: 'narduk-d1-recovery.v1', repository, sha, run, attempt, files }
    writeFileSync(
      join(scratch, 'd1-recovery-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    )
    const archive = join(scratch, 'recovery.tar.gz')
    execFileSync(
      'tar',
      [
        '-czf',
        archive,
        '-C',
        root,
        ...files.map((file) => file.path),
        '-C',
        scratch,
        'd1-recovery-manifest.json',
      ],
      { stdio: 'pipe' },
    )
    const receipt = {
      status: 'preserved',
      ...preserveObject({ context, file: archive, key, scratch }),
      files: files.length,
    }
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `\n## D1 recovery evidence\n\nFull archive preserved in the existing private CI artifact store and read back byte-for-byte.\n\n\`s3://${receipt.bucket}/${key}\`\n\nSHA-256: \`${receipt.sha256}\`; ${receipt.bytes} bytes; ${files.length} recovery files. Existing \`proof/\` lifecycle: 30 days.\n`,
      )
    return receipt
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Explicit manual proof of storage only; never evidence of a real migration. */
export function probeRecoveryStore({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}) {
  const context = storeContext(env)
  const key = `probe/${context.repository}/d1-recovery-${context.sha}-${context.run}-${context.attempt}.txt`
  const scratch = mkdtempSync(join(tmpdir(), 'd1-recovery-probe-'))
  try {
    const file = join(scratch, 'probe.txt')
    writeFileSync(file, 'narduk-d1-recovery-store-probe.v1\n', { mode: 0o600 })
    const receipt = { status: 'probe-verified', ...preserveObject({ context, file, key, scratch }) }
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `\n## D1 recovery store probe\n\nStorage-only fixed-payload PUT/GET matched byte-for-byte; this is not a migration recovery archive.\n\n\`s3://${receipt.bucket}/${key}\`\n\nSHA-256: \`${receipt.sha256}\`; ${receipt.bytes} bytes. Existing \`probe/\` lifecycle: one day.\n`,
      )
    return receipt
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Requires an explicit checkout so app-relative execution cannot miss root evidence. */
export function runRecoveryEvidenceCommand(args: string[]) {
  if (args.length === 1 && args[0] === '--probe') return probeRecoveryStore()
  if (args.length !== 2 || args[0] !== '--checkout' || !args[1] || args[1].startsWith('--')) {
    throw new Error('Usage: narduk-app db preserve-recovery --checkout <dir> | --probe')
  }
  return preserveRecovery({ root: resolve(args[1]) })
}
