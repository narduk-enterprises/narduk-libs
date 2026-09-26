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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { parse, visit, type ParseError } from 'jsonc-parser'
import { parse as parseYaml } from 'yaml'

import { globToRegExp } from './development-guards.js'

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
 * Anything that looks like the override taking a truthy value: `NAME=1`,
 * `NAME="1"`, `NAME: '1'`, `'NAME': '1'`, `env.NAME = 1`, `env['NAME'] = 1`. The broad net; `isSetter` then
 * excuses the two shapes that only read or mention the variable.
 */
const OVERRIDE_VALUE = new RegExp(`(${OVERRIDE})['"]?\\]?\\s*[:=]\\s*${TRUTHY}`, 'giu')

/** A shell word that assigns the override a truthy value (quotes already removed). */
const OVERRIDE_WORD = new RegExp(`^(${OVERRIDE})=${TRUTHY}`, 'iu')
const ASSIGNMENT_WORD = /^[a-z_]\w*=/iu

/** Commands whose later words may set the environment of what they run. */
const WRAPPERS = new Set([
  'command',
  'cross-env',
  'cross-env-shell',
  'declare',
  'dotenv',
  'env',
  'eval',
  'exec',
  'export',
  'local',
  'nice',
  'nohup',
  'readonly',
  'sudo',
  'time',
  'typeset',
])
/** Words that open a compound command; the simple command starts after them. */
const KEYWORDS = new Set(['!', 'do', 'elif', 'else', 'if', 'then', 'until', 'while'])

const JAVASCRIPT = /\.(?:mjs|cjs|js|ts|mts|cts)$/u
const MAX_SCANNED_FILE_BYTES = 1024 * 1024

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

interface QuotedSegment {
  /** Index of the opening quote. */
  start: number
  /** Index of the closing quote, or the text length when it never closes. */
  end: number
  content: string
}

/** Top-level quoted segments: '…', "…" (with backslash escapes) and `…`. */
function quotedSegments(text: string): QuotedSegment[] {
  const segments: QuotedSegment[] = []
  for (let index = 0; index < text.length; index += 1) {
    const quote = text[index]!
    if (quote !== '"' && quote !== "'" && quote !== '`') continue
    let end = index + 1
    while (end < text.length && text[end] !== quote)
      end += quote === "'" ? 1 : text[end] === '\\' ? 2 : 1
    end = Math.min(end, text.length)
    segments.push({ start: index, end, content: text.slice(index + 1, end) })
    index = end
  }
  return segments
}

/** Shell words of one command line, split into simple commands; quotes stay in the words. */
function simpleCommands(text: string): string[][] {
  const commands: string[][] = [[]]
  let word = ''
  const flush = () => {
    if (word) commands.at(-1)!.push(word)
    word = ''
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (char === '"' || char === "'") {
      const segment = quotedSegments(text.slice(index))[0]!
      word += text.slice(index, index + segment.end + 1)
      index += segment.end
    } else if (char === '\\') {
      word += text.slice(index, index + 2)
      index += 1
    } else if (/[;&|(){}`\n]/u.test(char)) {
      flush()
      commands.push([])
    } else if (/\s/u.test(char)) flush()
    else word += char
  }
  flush()
  return commands.filter((command) => command.length)
}

function unquote(word: string): string {
  return word.replaceAll(/["'`\\]/gu, '')
}

/**
 * Whether a command line, read on its own, sets the override: an assignment
 * word at the start of a simple command (after other assignments), any such
 * word after a wrapper such as `env`, `export`, `sudo` or `declare` (their own
 * options skipped), or the same inside any string the line quotes, since
 * `sh -c "…"`, `eval "…"` and `execSync("…")` run their string as a command.
 * `echo "…set NAME=1 for recovery"` stays clean: there the word is an argument.
 */
function commandSetsOverride(text: string): string | undefined {
  for (const command of simpleCommands(text)) {
    const words = command.map(unquote)
    while (words.length && KEYWORDS.has(words[0]!)) words.shift()
    const wrapped = WRAPPERS.has(words[0] ?? '')
    for (const [index, word] of words.entries()) {
      const match = OVERRIDE_WORD.exec(word)
      if (match && (wrapped || words.slice(0, index).every((w) => ASSIGNMENT_WORD.test(w))))
        return match[1]
    }
  }
  for (const segment of quotedSegments(text)) {
    const nested = commandSetsOverride(segment.content)
    if (nested) return nested
  }
  return undefined
}

/**
 * The override set on this line. Every match of the broad net counts except a
 * reader (`$NAME`, `${NAME…}`) and a match that lies wholly inside one quoted
 * string that does not itself set the override when run as a command.
 */
function lineSetsOverride(line: string): string | undefined {
  const segments = quotedSegments(line)
  for (const match of line.matchAll(OVERRIDE_VALUE)) {
    const start = match.index
    const end = start + match[0].length
    if (/\$\{?$/u.test(line.slice(0, start))) continue
    const segment = segments.find((candidate) => candidate.start < start && end <= candidate.end)
    if (segment && !commandSetsOverride(segment.content)) continue
    return match[1]
  }
  return undefined
}

/** The first line that sets an override, skipping whole-line comments. */
function armedOverride(
  text: string,
  javascript: boolean,
): { name: string; line: number } | undefined {
  for (const [index, raw] of text.split('\n').entries()) {
    const line = javascript ? raw.replaceAll(/\/\*.*?\*\//gu, '') : raw
    const trimmed = line.trimStart()
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue
    const name = lineSetsOverride(line)
    if (name) return { name: name.toUpperCase(), line: index + 1 }
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

interface WorkspaceMember {
  directory: string
  rel: string
  name?: string
}

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'bower_components'])
const MAX_WORKSPACE_DEPTH = 8

/**
 * Every package pnpm counts as a workspace member: the root plus each
 * directory matching `pnpm-workspace.yaml`'s `packages` globs (a leading `!`
 * excludes). A string is why they cannot be known; a forward by `--filter`
 * is then refused, because what it selects is unknown.
 */
function workspaceMembers(checkout: string): WorkspaceMember[] | string {
  const manifest = resolve(checkout, 'pnpm-workspace.yaml')
  if (!existsSync(manifest)) return 'there is no pnpm-workspace.yaml'
  let globs: unknown
  try {
    globs = (parseYaml(readFileSync(manifest, 'utf8')) as { packages?: unknown } | null)?.packages
  } catch (error) {
    return `pnpm-workspace.yaml does not parse (${error instanceof Error ? error.message : String(error)})`
  }
  if (!Array.isArray(globs) || !globs.every((glob) => typeof glob === 'string'))
    return 'pnpm-workspace.yaml declares no packages list'
  const clean = (glob: string) => glob.replace(/^!/u, '').replace(/^\.\//u, '').replace(/\/$/u, '')
  const include = globs.filter((glob) => !glob.startsWith('!')).map((g) => globToRegExp(clean(g)))
  const exclude = globs.filter((glob) => glob.startsWith('!')).map((g) => globToRegExp(clean(g)))
  const members: WorkspaceMember[] = []
  const visit = (directory: string, depth: number) => {
    const rel = relative(checkout, directory).split(sep).join('/')
    const selected =
      rel === '' ||
      (include.some((glob) => glob.test(rel)) && !exclude.some((glob) => glob.test(rel)))
    if (selected && existsSync(resolve(directory, 'package.json'))) {
      const pkg = parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as {
        name?: unknown
      } | null
      members.push({
        directory,
        rel: rel || '.',
        name: typeof pkg?.name === 'string' ? pkg.name : undefined,
      })
    }
    if (depth >= MAX_WORKSPACE_DEPTH) return
    for (const entry of readdirSync(directory, { withFileTypes: true }))
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name))
        visit(resolve(directory, entry.name), depth + 1)
  }
  visit(checkout, 0)
  return members
}

/** Why a `deploy:dev` is not the enrolled command or a forward to it, or undefined when it is. */
function deployDevProblem(
  pkg: WorkspacePackage,
  packages: readonly WorkspacePackage[],
  members: () => WorkspaceMember[] | string,
): string | undefined {
  const command = pkg.scripts['deploy:dev']
  if (typeof command === 'string' && ENROLLED_DEPLOY.test(command)) return undefined
  const forward = typeof command === 'string' ? FORWARDED_DEPLOY.exec(command) : null
  if (!forward) return `runs ${JSON.stringify(command)}, not narduk-app development deploy`
  const [, flag, value] = forward as unknown as [string, string, string]
  let directory: string
  if (flag === '-C' || flag === '--dir') directory = resolve(pkg.directory, value)
  else {
    // `--filter <name>` runs every member with that name, and `--filter ./dir`
    // every member under that directory: exactly one may be selected.
    const known = members()
    if (typeof known === 'string')
      return `forwards with ${flag} ${value}, but ${known}, so which packages it runs is unknown`
    const byPath = /^[./]/u.test(value)
    const selected = known.filter((member) =>
      byPath
        ? member.directory === resolve(pkg.directory, value) ||
          inside(resolve(pkg.directory, value), member.directory)
        : member.name === value,
    )
    if (selected.length !== 1)
      return `forwards with ${flag} ${value}, which selects ${selected.length} workspace packages${
        selected.length ? ` (${selected.map((member) => member.rel).join(', ')})` : ''
      }; a forward must select exactly one enrolled component`
    directory = selected[0]!.directory
  }
  const target = packages.find(
    (candidate) => candidate.component && candidate !== pkg && candidate.directory === directory,
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
  let members: WorkspaceMember[] | string | undefined
  const workspace = () => (members ??= workspaceMembers(checkout))
  for (const pkg of packages) {
    const at = (script: string, reason: string) =>
      findings.push({ packageJson: pkg.rel, script, reason })
    if (pkg.deployDevDeclarations > 1)
      at(
        'deploy:dev',
        `is declared ${pkg.deployDevDeclarations} times; JSON keeps the last, so a merge can re-arm a retired script`,
      )
    if (pkg.scripts['deploy:dev'] !== undefined) {
      const problem = deployDevProblem(pkg, packages, workspace)
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
