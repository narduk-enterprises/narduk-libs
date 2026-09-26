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
 * A `pnpm --filter` forward asks pnpm itself which packages it selects
 * (`pnpm --filter <value> ls --json --depth -1`).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
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
 * Anything that looks like the override taking a truthy value: `NAME=1`,
 * `NAME="1"`, `NAME: '1'`, `'NAME': '1'`, `env.NAME = 1`, `env['NAME'] = 1`.
 * This broad net is the floor; `lineSetsOverride` excuses only a reader and a
 * message.
 */
const OVERRIDE_VALUE = new RegExp(`(${OVERRIDE})['"]?\\]?\\s*[:=]\\s*${TRUTHY}`, 'giu')

/** Words that open a compound command; the simple command starts after them. */
const KEYWORDS = new Set(['!', 'do', 'elif', 'else', 'if', 'then', 'until', 'while'])
/** Shell commands whose quoted arguments are only printed. */
const PRINTERS = new Set(['echo', 'printf'])
/** A redirection that only sends a printer's output to stdout or stderr. */
const TERMINAL_REDIRECT = /^[12]?>&[12]$/u
/** A JS call whose first string argument is only a message. */
const MESSAGE_CALL =
  /(?:\bconsole\s*\.\s*\w+|\bnew\s+\w*Error|\blogger\s*\.\s*\w+|\b(?:log|warn|fail|die|abort|info|debug|error))\s*\(\s*$|\bthrow\s+$/u

const JAVASCRIPT = /\.(?:mjs|cjs|js|ts|mts|cts)$/u
const MAX_SCANNED_FILE_BYTES = 1024 * 1024

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

interface QuotedSegment {
  quote: string
  /** Index of the opening quote. */
  start: number
  /** Index of the closing quote; an unclosed quote is not a segment. */
  end: number
  content: string
}

/** The quoted string starting at `start`, or undefined when it never closes. */
function quotedAt(text: string, start: number): QuotedSegment | undefined {
  const quote = text[start]!
  let end = start + 1
  while (end < text.length && text[end] !== quote)
    end += quote !== "'" && text[end] === '\\' ? 2 : 1
  if (end >= text.length) return undefined
  return { quote, start, end, content: text.slice(start + 1, end) }
}

/** JS string literals on one line: '…', "…" and `…`. */
function javascriptStrings(line: string): QuotedSegment[] {
  const segments: QuotedSegment[] = []
  for (let index = 0; index < line.length; index += 1) {
    if (!`'"\``.includes(line[index]!)) continue
    const segment = quotedAt(line, index)
    if (!segment) break
    segments.push(segment)
    index = segment.end
  }
  return segments
}

interface ShellWord {
  text: string
  start: number
}

interface ShellCommand {
  words: ShellWord[]
  segments: QuotedSegment[]
  /** The separator before the command (`''` at the start of the line). */
  opener: string
  /** The separator after it (`''` at the end of the line). */
  closer: string
}

/**
 * One shell line split into simple commands. A backslash escapes the next
 * character, so `\"` opens no string; a backtick is a command substitution and
 * a separator; an unclosed quote runs to the end of the line as plain text.
 */
function shellCommands(line: string): ShellCommand[] {
  const commands: ShellCommand[] = []
  let current: ShellCommand = { words: [], segments: [], opener: '', closer: '' }
  let word: ShellWord | undefined
  const flush = () => {
    if (word) current.words.push(word)
    word = undefined
  }
  const extend = (index: number, text: string) => {
    word ??= { text: '', start: index }
    word.text += text
  }
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (char === '\\') {
      extend(index, line.slice(index, index + 2))
      index += 1
    } else if (char === '"' || char === "'") {
      const segment = quotedAt(line, index)
      if (!segment) {
        extend(index, line.slice(index))
        break
      }
      current.segments.push(segment)
      extend(index, line.slice(index, segment.end + 1))
      index = segment.end
    } else if (char === '&' && (/[<>]/u.test(line[index - 1] ?? '') || line[index + 1] === '>')) {
      extend(index, char) // `>&2`, `<&0` and `&>file` are redirections, not separators
    } else if (/[;&|(){}`\n]/u.test(char)) {
      flush()
      const separator = char === '(' && line[index - 1] === '$' ? '$(' : char
      current.closer =
        char === '|' && line[index + 1] !== '|' && line[index - 1] !== '|' ? '|' : char
      commands.push(current)
      current = { words: [], segments: [], opener: separator, closer: '' }
    } else if (/\s/u.test(char)) flush()
    else extend(index, char)
  }
  flush()
  commands.push(current)
  return commands
}

/**
 * Whether a quoted shell string is only printed: an argument of `echo` or
 * `printf` whose output reaches the terminal. Output piped on, redirected to a
 * file or captured by `$(…)`/backticks can be run or loaded, so it counts, and
 * so does a double-quoted string that itself substitutes a command.
 */
function shellMessage(command: ShellCommand, segment: QuotedSegment): boolean {
  if (segment.quote === '"' && /\$\(|`/u.test(segment.content)) return false
  if (command.opener === '$(' || command.opener === '`' || command.closer === '|') return false
  const words = command.words.map((word) => word.text)
  while (words.length && KEYWORDS.has(words[0]!)) words.shift()
  if (!PRINTERS.has(words[0] ?? '')) return false
  return command.words.every((word) => {
    const bare = word.text.replaceAll(/'[^']*'|"(?:\\.|[^"\\])*"|\\./gu, '')
    return !/[<>]/u.test(bare) || TERMINAL_REDIRECT.test(bare)
  })
}

/** Whether a JS string literal is only a message: the first argument of console.*, an Error or a log helper. */
function javascriptMessage(line: string, segment: QuotedSegment): boolean {
  if (segment.quote === '`' && segment.content.includes('${')) return false
  return MESSAGE_CALL.test(line.slice(0, segment.start))
}

/**
 * The override set on this line. Every match of the broad net counts except a
 * reader (`$NAME`, `${NAME…}`) and a match wholly inside a quoted string that
 * is only a message: an `echo`/`printf` argument in shell, the first argument
 * of console.*, an Error or a log helper in JS. A string run as a command
 * (`sh -c '…'`, `execSync("…")`) is not a message, so any setter in it counts.
 */
function lineSetsOverride(line: string, javascript: boolean): string | undefined {
  const commands = javascript ? [] : shellCommands(line)
  const strings = javascript ? javascriptStrings(line) : []
  for (const match of line.matchAll(OVERRIDE_VALUE)) {
    const start = match.index
    const end = start + match[0].length
    if (/\$\{?$/u.test(line.slice(0, start))) continue
    const within = (segment: QuotedSegment) => segment.start < start && end <= segment.end
    if (javascript) {
      const segment = strings.find(within)
      if (segment && javascriptMessage(line, segment)) continue
    } else {
      const command = commands.find((candidate) => candidate.segments.some(within))
      const segment = command?.segments.find(within)
      if (command && segment && shellMessage(command, segment)) continue
    }
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
    if (javascript ? trimmed.startsWith('//') : trimmed.startsWith('#')) continue
    const name = lineSetsOverride(line, javascript)
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

/** A package a pnpm filter selects: its name and absolute directory. */
export interface WorkspaceSelection {
  name?: string
  path: string
}

const PNPM_TIMEOUT_MS = 20_000
/** A filter that names one package (`web`, `@scope/web`) or one directory (`./apps/web`). */
const FILTER_VALUE =
  /^(?:(?:@[\w-]+(?:\.[\w-]+)*\/)?[\w-]+(?:\.[\w-]+)*|\.\.?(?:\/[\w-]+(?:\.[\w-]+)*)+\/?)$/u

/**
 * Asks pnpm which workspace packages `pnpm --filter <filter>` selects when run
 * from `cwd`, with `pnpm --filter <filter> ls --json --depth -1` (read only).
 * pnpm's own answer, so its globs, symlinks, package.yaml and filter syntax
 * are never re-implemented. A string is why pnpm could not say.
 */
function pnpmSelection(cwd: string, filter: string): WorkspaceSelection[] | string {
  const execPath = process.env.npm_execpath
  const viaNode = execPath && /pnpm/u.test(execPath) && /\.c?js$/u.test(execPath)
  const [command, prefix] = viaNode ? [process.execPath, [execPath]] : ['pnpm', []]
  const result = spawnSync(
    command,
    [...prefix, '--filter', filter, 'ls', '--json', '--depth', '-1'],
    {
      cwd,
      encoding: 'utf8',
      timeout: PNPM_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, npm_config_manage_package_manager_versions: 'false' },
    },
  )
  if (result.error) return `pnpm could not be asked what it selects (${result.error.message})`
  if (result.status !== 0)
    return `pnpm could not list what it selects (exit ${result.status ?? result.signal})`
  try {
    // Outside a workspace pnpm prints one array per selected package.
    const listed: unknown = JSON.parse(result.stdout.trim().replaceAll(/\]\s*\[/gu, ',') || '[]')
    if (
      Array.isArray(listed) &&
      listed.every((entry) => entry && typeof (entry as { path?: unknown }).path === 'string')
    )
      return (listed as Array<{ name?: unknown; path: string }>).map((entry) => ({
        name: typeof entry.name === 'string' ? entry.name : undefined,
        path: entry.path,
      }))
  } catch {
    // falls through to the refusal below
  }
  return 'pnpm listed what it selects in a shape this check cannot read'
}

/** The pnpm query; tests replace `select` to run without pnpm. */
export const workspaceFilter = { select: pnpmSelection }

function sameDirectory(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right)
  } catch {
    return resolve(left) === resolve(right)
  }
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
  let directory: string
  let exact = true
  if (flag === '-C' || flag === '--dir') directory = resolve(pkg.directory, value)
  else if (!FILTER_VALUE.test(value))
    return `forwards with ${flag} ${value}; a forward names one package or one ./directory, with no glob or graph selector`
  else {
    exact = false
    // `--filter web` runs every package pnpm selects: exactly one may be.
    const selected = workspaceFilter.select(pkg.directory, value)
    if (typeof selected === 'string')
      return `forwards with ${flag} ${value}, but ${selected}, so which packages it runs is unknown`
    if (selected.length !== 1)
      return `forwards with ${flag} ${value}, which pnpm resolves to ${selected.length} workspace packages${
        selected.length
          ? ` (${selected.map((member) => relative(pkg.directory, member.path).split(sep).join('/') || '.').join(', ')})`
          : ''
      }; a forward must select exactly one enrolled component`
    directory = selected[0]!.path
  }
  const target = packages.find(
    (candidate) =>
      candidate.component &&
      candidate !== pkg &&
      (exact ? candidate.directory === directory : sameDirectory(candidate.directory, directory)),
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
