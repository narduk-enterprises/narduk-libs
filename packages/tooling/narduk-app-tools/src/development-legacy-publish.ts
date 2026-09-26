/**
 * An app-owned publish path that would stay armed against an enrolled target
 * (agent-infrastructure#1679). Apps that published themselves from a
 * workstation before development mode existed kept their own `deploy:dev`
 * script and its own authorization record; enrollment left both working, so
 * the legacy path published past the custody record and the refusal landed on
 * the next honest deploy.
 *
 * `development enter` refuses while one is present rather than disarming it:
 * the tool cannot find an app's own authorization record, and editing tracked
 * files in the integration checkout would neither reach other worktrees nor
 * leave the capture clean. Refusing changes nothing in the app, so exit has
 * nothing to restore.
 *
 * Read only: the root `package.json` and each enrolled component's
 * `appDir/package.json`, plus any checkout file a script there runs directly.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { parse, visit, type ParseError } from 'jsonc-parser'

export interface LegacyPublishPath {
  /** Checkout-relative package.json. */
  packageJson: string
  script: string
  reason: string
}

/** The one command a `deploy:dev` script may run while enrolled. */
const ENROLLED_DEPLOY =
  /^(?:(?:pnpm(?:\s+exec)?|npx)\s+)?narduk-app\s+development\s+deploy(?:\s+[^\s;&|<>`$()\\]+)*\s*$/u

/**
 * A script that grants itself a workstation publish override. Reads such as
 * `${NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY:-}` or `"$NARDUK_ALLOW_MANUAL_PROMOTE" = "1"`
 * (a guard) do not match; `NAME=1`, `export NAME=1` and `NAME: '1'` do.
 */
const ARMED_OVERRIDE =
  /\b(NARDUK_ALLOW_(?:MANUAL_PROMOTE|LOCAL_WRANGLER_DEPLOY))\s*[:=]\s*['"]?(?:1|true|yes|on)\b/iu

const MAX_SCANNED_FILE_BYTES = 1024 * 1024

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** The first line that arms an override, skipping whole-line comments. */
function armedOverride(text: string): { name: string; line: number } | undefined {
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue
    const match = ARMED_OVERRIDE.exec(line)
    if (match) return { name: match[1]!.toUpperCase(), line: index + 1 }
  }
  return undefined
}

/** Checkout files a script command runs directly (`script/x.sh`, `node ./y.mjs`). */
function referencedFiles(command: string, packageDir: string, checkout: string): string[] {
  const files: string[] = []
  for (const raw of command.split(/[\s;&|()]+/u)) {
    const token = raw.replaceAll(/^['"]|['"]$/gu, '')
    if (!token || token.startsWith('-') || token.includes('$')) continue
    if (!token.includes('/') && !/\.(?:sh|bash|zsh|mjs|cjs|js|ts)$/u.test(token)) continue
    const path = resolve(packageDir, token)
    if (!inside(checkout, path) || !existsSync(path)) continue
    try {
      const stat = statSync(path)
      if (stat.isFile() && stat.size <= MAX_SCANNED_FILE_BYTES) files.push(path)
    } catch {
      // unreadable: nothing to scan
    }
  }
  return files
}

/** Every `scripts.deploy:dev` key in the raw text, in order; JSON keeps the last. */
function deployDevDeclarations(text: string): number {
  let count = 0
  visit(text, {
    onObjectProperty: (property, _offset, _length, _line, _column, pathSupplier) => {
      const path = pathSupplier()
      if (property === 'deploy:dev' && path.length === 1 && path[0] === 'scripts') count += 1
    },
  })
  return count
}

function inspectPackageJson(checkout: string, packageJson: string): LegacyPublishPath[] {
  const rel = relative(checkout, packageJson).split(sep).join('/')
  const text = readFileSync(packageJson, 'utf8')
  const errors: ParseError[] = []
  const pkg = parse(text, errors, { disallowComments: true }) as {
    scripts?: Record<string, unknown>
  } | null
  if (errors.length || !pkg || typeof pkg !== 'object')
    return [
      {
        packageJson: rel,
        script: '(file)',
        reason: 'does not parse as JSON, so what "deploy:dev" runs cannot be known',
      },
    ]
  const findings: LegacyPublishPath[] = []
  const declarations = deployDevDeclarations(text)
  if (declarations > 1)
    findings.push({
      packageJson: rel,
      script: 'deploy:dev',
      reason: `is declared ${declarations} times; JSON keeps the last, so a merge can re-arm a retired script`,
    })
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
  const deployDev = scripts['deploy:dev']
  if (
    deployDev !== undefined &&
    !(typeof deployDev === 'string' && ENROLLED_DEPLOY.test(deployDev))
  )
    findings.push({
      packageJson: rel,
      script: 'deploy:dev',
      reason: `runs ${JSON.stringify(deployDev)}, not narduk-app development deploy`,
    })
  const packageDir = dirname(packageJson)
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') continue
    const inline = armedOverride(command)
    if (inline) {
      findings.push({
        packageJson: rel,
        script: name,
        reason: `sets ${inline.name}, a workstation publish override`,
      })
      continue
    }
    for (const file of referencedFiles(command, packageDir, checkout)) {
      const armed = armedOverride(readFileSync(file, 'utf8'))
      if (!armed) continue
      findings.push({
        packageJson: rel,
        script: name,
        reason: `runs ${relative(checkout, file).split(sep).join('/')}, which sets ${armed.name} (line ${armed.line})`,
      })
      break
    }
  }
  return findings
}

/** App-owned publish paths in the root and each component's package.json. */
export function findLegacyPublishPaths(
  checkout: string,
  appDirs: readonly string[],
): LegacyPublishPath[] {
  const seen = new Set<string>()
  const findings: LegacyPublishPath[] = []
  for (const dir of ['.', ...appDirs]) {
    const packageJson = resolve(checkout, dir, 'package.json')
    if (seen.has(packageJson) || !existsSync(packageJson)) continue
    seen.add(packageJson)
    findings.push(...inspectPackageJson(checkout, packageJson))
  }
  return findings
}

export function describeLegacyPublishPath(finding: LegacyPublishPath): string {
  return `${finding.packageJson} "${finding.script}" ${finding.reason}`
}

export function legacyPublishRefusal(findings: readonly LegacyPublishPath[]): string {
  return [
    'An app-owned publish path would stay armed against the enrolled target and publish past the custody record (agent-infrastructure#1679):',
    ...findings.map((finding) => `  ${describeLegacyPublishPath(finding)}`),
    'Retire it in this checkout first: delete the legacy script, keep exactly one "deploy:dev": "narduk-app development deploy", commit, then re-run enter.',
    'Retire any authorization record the legacy script kept outside the repository with it. Entry changed nothing in the app.',
  ].join('\n')
}
