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
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { parse, visit, type ParseError } from 'jsonc-parser'

export interface LegacyPublishPath {
  /** Checkout-relative package.json. */
  packageJson: string
  script: string
  reason: string
}

/** A shell word with no quoting, expansion, redirection or command separator. */
const PLAIN_WORD = '[^\\s;&|<>`$()\\\\\'"]+'
const ARGUMENTS = `(?:[ \\t]+${PLAIN_WORD})*`

/** The one command a component's `deploy:dev` may run while enrolled. */
const ENROLLED_DEPLOY = new RegExp(
  `^(?:(?:pnpm(?:[ \\t]+exec)?|npx)[ \\t]+)?narduk-app[ \\t]+development[ \\t]+deploy${ARGUMENTS}[ \\t]*$`,
  'u',
)

/**
 * A `deploy:dev` that only forwards to one workspace package's own
 * `deploy:dev`, as create-narduk-app writes at the root
 * (`pnpm --filter web run deploy:dev`).
 */
const FORWARDED_DEPLOY = new RegExp(
  `^pnpm[ \\t]+(--filter|-F|-C|--dir)(?:=|[ \\t]+)(${PLAIN_WORD})[ \\t]+run[ \\t]+deploy:dev${ARGUMENTS}[ \\t]*$`,
  'u',
)

/** Scripts pnpm runs by itself around `deploy:dev`. */
const LIFECYCLE_SCRIPTS = ['predeploy:dev', 'postdeploy:dev']

const OVERRIDE = 'NARDUK_ALLOW_(?:MANUAL_PROMOTE|LOCAL_WRANGLER_DEPLOY)'
const TRUTHY = `['"]?(?:1|true|yes|on)\\b`

/**
 * A shell assignment in command position: at the start, after a separator, or
 * after `export`/`env`/`cross-env`, possibly after other assignments. A reader
 * (`${NAME:-}`, `[ $NAME = 1 ]`) or a word inside an `echo` never is.
 */
const SHELL_SETTER = new RegExp(
  `(?:^|[;&|(){}]|\\b(?:then|do|else|export|env|cross-env(?:-shell)?)\\b)[ \\t]*(?:[a-z_]\\w*=[^\\s;&|]*[ \\t]+)*(${OVERRIDE})=${TRUTHY}`,
  'iu',
)

/**
 * A JavaScript setter: `NAME: '1'`, `env.NAME = '1'`, `env['NAME'] = '1'`, or a
 * quoted command that sets it. `env.NAME == 1` is a comparison: the value
 * pattern cannot start with `=`.
 */
const SCRIPT_SETTERS = [
  new RegExp(`(?:^|[^\\w$.])['"]?(${OVERRIDE})['"]?[ \\t]*:[ \\t]*${TRUTHY}`, 'iu'),
  new RegExp(`(?:\\.|\\[['"])(${OVERRIDE})(?:['"]\\])?[ \\t]*=[ \\t]*${TRUTHY}`, 'iu'),
  new RegExp(`['"\`][ \\t]*(?:[a-z_]\\w*=[^\\s;&|]*[ \\t]+)*(${OVERRIDE})=${TRUTHY}`, 'iu'),
]

const JAVASCRIPT = /\.(?:mjs|cjs|js|ts|mts|cts)$/u
const MAX_SCANNED_FILE_BYTES = 1024 * 1024

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * The line with every quoted string emptied except a value quoted right after
 * `=` (`NAME="1"`), so message text such as
 * `echo "set NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1 for recovery"` is not code.
 */
function blankQuoted(line: string): string {
  let out = ''
  let quote: string | undefined
  let keep = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (quote) {
      if (quote === '"' && char === '\\') {
        if (keep) out += line.slice(index, index + 2)
        index += 1
      } else if (char === quote) {
        out += char
        quote = undefined
      } else if (keep) out += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      keep = line[index - 1] === '='
    }
    out += char
  }
  return out
}

function shellSetter(line: string): RegExpExecArray | null {
  const code = blankQuoted(line).replace(/(?:^|\s)#.*$/u, '')
  return SHELL_SETTER.exec(code)
}

/** The first line that sets an override, skipping whole-line comments. */
function armedOverride(
  text: string,
  javascript: boolean,
): { name: string; line: number } | undefined {
  for (const [index, line] of text.split('\n').entries()) {
    const trimmed = line.trimStart()
    if (javascript ? /^(?:\/\/|\/?\*)/u.test(trimmed) : trimmed.startsWith('#')) continue
    const match = javascript
      ? SCRIPT_SETTERS.map((pattern) => pattern.exec(line)).find(Boolean)
      : shellSetter(line)
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

/** How many times `scripts.deploy:dev` is declared in the raw text; JSON keeps the last. */
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

interface WorkspacePackage {
  directory: string
  rel: string
  component: boolean
  name?: string
  scripts: Record<string, unknown>
  deployDevDeclarations: number
}

function readPackage(
  checkout: string,
  directory: string,
  component: boolean,
  findings: LegacyPublishPath[],
): WorkspacePackage | undefined {
  const packageJson = resolve(directory, 'package.json')
  const rel = relative(checkout, packageJson).split(sep).join('/')
  const text = readFileSync(packageJson, 'utf8')
  const errors: ParseError[] = []
  const pkg = parse(text, errors, { disallowComments: true }) as {
    name?: unknown
    scripts?: unknown
  } | null
  if (errors.length || !pkg || typeof pkg !== 'object') {
    findings.push({
      packageJson: rel,
      script: '(file)',
      reason: 'does not parse as JSON, so what "deploy:dev" runs cannot be known',
    })
    return undefined
  }
  return {
    directory,
    rel,
    component,
    name: typeof pkg.name === 'string' ? pkg.name : undefined,
    scripts:
      pkg.scripts && typeof pkg.scripts === 'object'
        ? (pkg.scripts as Record<string, unknown>)
        : {},
    deployDevDeclarations: deployDevDeclarations(text),
  }
}

function enrolledDeploy(pkg: WorkspacePackage): boolean {
  const command = pkg.scripts['deploy:dev']
  return (
    pkg.deployDevDeclarations <= 1 && typeof command === 'string' && ENROLLED_DEPLOY.test(command)
  )
}

/** Why a `deploy:dev` is not the enrolled command or a forward to it, or undefined when it is. */
function deployDevProblem(
  pkg: WorkspacePackage,
  packages: readonly WorkspacePackage[],
): string | undefined {
  const command = pkg.scripts['deploy:dev']
  if (typeof command === 'string' && ENROLLED_DEPLOY.test(command)) return undefined
  const forward = typeof command === 'string' ? FORWARDED_DEPLOY.exec(command) : null
  if (!forward) return `runs ${JSON.stringify(command)}, not narduk-app development deploy`
  const [, flag, value] = forward as unknown as [string, string, string]
  const byPath = flag === '-C' || flag === '--dir' || /^[./]/u.test(value)
  const target = packages.find(
    (candidate) =>
      candidate.component &&
      candidate !== pkg &&
      (byPath ? candidate.directory === resolve(pkg.directory, value) : candidate.name === value),
  )
  if (!target) return `forwards to ${JSON.stringify(value)}, which is not an enrolled component`
  if (!enrolledDeploy(target))
    return `forwards to ${target.rel}, whose deploy:dev is not exactly narduk-app development deploy`
  return undefined
}

/** App-owned publish paths in the root and each component's package.json. */
export function findLegacyPublishPaths(
  checkout: string,
  appDirs: readonly string[],
): LegacyPublishPath[] {
  const findings: LegacyPublishPath[] = []
  const components = new Set(appDirs.map((dir) => resolve(checkout, dir)))
  const packages: WorkspacePackage[] = []
  for (const directory of new Set([resolve(checkout), ...components])) {
    if (!existsSync(resolve(directory, 'package.json'))) continue
    const pkg = readPackage(checkout, directory, components.has(directory), findings)
    if (pkg) packages.push(pkg)
  }
  for (const pkg of packages) {
    const at = (script: string, reason: string) =>
      findings.push({ packageJson: pkg.rel, script, reason })
    if (pkg.deployDevDeclarations > 1)
      at(
        'deploy:dev',
        `is declared ${pkg.deployDevDeclarations} times; JSON keeps the last, so a merge can re-arm a retired script`,
      )
    if (pkg.scripts['deploy:dev'] !== undefined) {
      const problem = deployDevProblem(pkg, packages)
      if (problem) at('deploy:dev', problem)
    }
    for (const name of LIFECYCLE_SCRIPTS)
      if (pkg.scripts[name] !== undefined)
        at(name, 'runs automatically around deploy:dev; development deploy owns that path')
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (typeof command !== 'string') continue
      const inline = armedOverride(command, false)
      if (inline) {
        at(name, `sets ${inline.name}, a workstation publish override`)
        continue
      }
      for (const file of referencedFiles(command, pkg.directory, checkout)) {
        const armed = armedOverride(readFileSync(file, 'utf8'), JAVASCRIPT.test(file))
        if (!armed) continue
        at(
          name,
          `runs ${relative(checkout, file).split(sep).join('/')}, which sets ${armed.name} (line ${armed.line})`,
        )
        break
      }
    }
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
    'Retire it in this checkout first: delete the legacy script, keep exactly one "deploy:dev" per package (the component runs narduk-app development deploy; the root may only forward to it), commit, then re-run enter.',
    'Retire any authorization record the legacy script kept outside the repository with it. Entry changed nothing in the app.',
  ].join('\n')
}
