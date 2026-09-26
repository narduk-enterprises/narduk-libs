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
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

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
 * This broad net is the floor; `setterIn` excuses only a reader and a message
 * printed to stderr.
 */
const OVERRIDE_VALUE = new RegExp(`(${OVERRIDE})['"]?\\]?\\s*[:=]\\s*${TRUTHY}`, 'giu')
/** A shell default-assignment (`${NAME=1}`, `${NAME:=1}`) sets the variable wherever it expands. */
const DEFAULT_ASSIGN = new RegExp(`\\$\\{(${OVERRIDE}):?=\\s*${TRUTHY}`, 'iu')

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

/*
 * Messages. A guard that refuses prints the override's name to stderr
 * (`echo "Set NAME=1 after reviewing" >&2`), and flagging that text would
 * refuse the guard itself. A printed string is excused only where nothing in
 * scope can turn it back into a command: shell output that reaches stderr
 * directly, and JS console.error/console.warn or a thrown Error in a file that
 * cannot rewire them. A script or shell file in scope that captures stderr,
 * sources code or redefines a printer, or a pnpm script-shell setting,
 * withdraws every excuse; a JS file that can read a child's stderr withdraws
 * the excuse from what it names.
 */

/** Shell commands whose quoted arguments are only printed. */
const PRINTERS = new Set(['echo', 'printf'])
/** The one redirection a printed message may carry: stdout onto stderr. */
const TO_STDERR = /^1?>&2$/u
/** Words that begin a command list without being its command. */
const LIST_WORDS = new Set(['!', 'then', 'else', 'elif', 'do'])
const COMPOUND_OPENERS: Record<string, ShellGroupKind> = {
  if: 'if',
  while: 'loop',
  until: 'loop',
  for: 'loop',
  select: 'loop',
  case: 'case',
}
const COMPOUND_CLOSERS: Record<string, ShellGroupKind> = { fi: 'if', done: 'loop', esac: 'case' }
/** Groups whose output goes wherever the group's own output goes. */
const TRANSPARENT_GROUPS = new Set<ShellGroupKind>(['{', '(', 'if', 'loop', 'case'])
const QUOTED_PART = /'[^']*'|"(?:\\.|[^"\\])*"|\\./gu

/** Output thrown away for good: `>/dev/null 2>&1`, `2>/dev/null`, `&>/dev/null`. */
const DISCARD = /(?:[12]?>|&>)\s*\/dev\/null(?:\s+2>&1)?/gu
/** stderr sent anywhere but the terminal, or a descriptor juggled so it can be. */
const STDERR_CAPTURE = /(?<![\w-])(?:2|[3-9]\d*)[<>]|&>|\|&|>&\s*(?!2\b)[\w$-]/u
/** Code that can make `echo`/`printf` do something other than print. */
const SHELL_REWIRING = new RegExp(
  [
    `(?:^|[;&|({!'"\`]|[)}]\\s|\\b(?:then|do|else))\\s*(?:source|\\.|trap|alias|enable|shopt|hash)\\s`,
    `\\b(?:export|declare|typeset|local|readonly)\\s+-\\w*f`,
    `\\b(?:echo|printf)\\s*\\(\\s*\\)`,
    `\\bfunction\\s+(?:echo|printf)\\b`,
    `\\bBASH_(?:ENV|FUNC)`,
    `(?:^|[\\s;&|'"])ENV=`,
  ].join('|'),
  'mu',
)
/** A caller that preloads code into node, which can rewire console or Error. */
const NODE_PRELOAD =
  /\bNODE_OPTIONS\b|--(?:require|import|loader|experimental-loader)\b|(?:^|\s)-r\s/mu
/** A JS file that can read another process's stderr. */
const JAVASCRIPT_CAPTURE =
  /\bstderr\b|\bstdio\b|\.output\b|\b(?:exec|execFile|spawn|fork)\s*\(|\bcatch\b/u
/** A JS file that can load other code or rewire console, Error or stderr. */
const JAVASCRIPT_REWIRING =
  /\b(?:import|require|eval|Function|globalThis|global|Reflect|Proxy|defineProperty|defineProperties|setPrototypeOf|prototype|__proto__|assign|catch|uncaughtException|unhandledRejection|setUncaughtExceptionCaptureCallback|prepareStackTrace|Console|stderr|stdio|output)\b|\bprocess\s*(?:\[|\.\s*(?:on|once|addListener|prependListener|prependOnceListener)\b)/u
const CONSOLE_USE = /\bconsole\b/gu
const CONSOLE_CALL = /(?<![\w$.])console\s*\.\s*(?:error|warn|log|info|debug)\s*\(/gu
/** Where a JS message literal may sit: first argument of console.error/warn or of a directly thrown Error. */
const MESSAGE_CALL = /(?:\bconsole\s*\.\s*(?:error|warn)|\bthrow\s+new\s+\w*Error)\s*\(\s*$/u
/** A pnpm setting that replaces the shell scripts run in. */
const SCRIPT_SHELL = /script-?shell|shell-?emulator/iu

/** The `)` of a function definition's `name()`. */
const FUNCTION_PARENS = /\s*\)/uy

function emptyParensAt(text: string, index: number): boolean {
  FUNCTION_PARENS.lastIndex = index
  return FUNCTION_PARENS.test(text)
}

type ShellGroupKind = '{' | '(' | '$(' | '`' | 'if' | 'loop' | 'case'

interface ShellGroup {
  kind: ShellGroupKind
  /** A function body, whose output every call site can redirect. */
  functionBody: boolean
  /** The group itself sits in a pipeline. */
  piped: boolean
  /** Words after the closer (its redirections); undefined while still open. */
  tail?: string[]
}

interface ShellCommand {
  words: string[]
  segments: QuotedSegment[]
  /** Enclosing groups, outermost first. */
  groups: ShellGroup[]
  /** Reads from or writes to a pipe. */
  piped: boolean
  /** Set when this command is the redirection tail of a group just closed. */
  tailOf?: ShellGroup
  /** Words run on from a command substitution (`$(…) echo`), so the first is not the command. */
  continued?: boolean
}

/**
 * A shell text split into simple commands, tracking the groups around each:
 * `{ }`, `( )`, `$( )`, `<( )`, backticks, if/fi, loops and case/esac. A
 * backslash escapes the next character (so `\"` opens no string); `#` at a
 * word start runs to the end of the line; a here-document body is skipped, so
 * nothing in it is a message; an unclosed quote ends the scan.
 */
function shellCommands(text: string): ShellCommand[] {
  const commands: ShellCommand[] = []
  const stack: ShellGroup[] = []
  const heredocs: Array<{ delimiter: string; strip: boolean }> = []
  let current: ShellCommand = { words: [], segments: [], groups: [], piped: false }
  let word: string | undefined
  let functionNext = false

  const start = (piped: boolean, tailOf?: ShellGroup) => {
    current = { words: [], segments: [], groups: [...stack], piped, tailOf }
  }
  const end = (pipe: boolean) => {
    flushWord()
    if (pipe) current.piped = true
    if (current.tailOf) {
      current.tailOf.tail = current.words
      if (current.piped) current.tailOf.piped = true
    }
    commands.push(current)
    start(pipe)
  }
  const open = (kind: ShellGroupKind) => {
    flushWord()
    const piped = current.piped
    if (current.words.length || current.segments.length) end(false)
    stack.push({ kind, functionBody: functionNext, piped })
    functionNext = false
    start(false)
  }
  const close = (kind: ShellGroupKind): boolean => {
    if (stack.at(-1)?.kind !== kind) return false
    end(false)
    const group = stack.pop()!
    start(false, group)
    return true
  }
  function flushWord() {
    if (word === undefined) return
    const text = word
    word = undefined
    const empty = current.words.length === 0
    if (empty) {
      if (text === '}' && close('{')) return
      const closer = COMPOUND_CLOSERS[text]
      if (closer && close(closer)) return
    }
    const first = empty && !current.tailOf
    if (text === '{' && (first || functionNext)) return open('{')
    if (first) {
      const opener = COMPOUND_OPENERS[text]
      if (opener) return open(opener)
      if (LIST_WORDS.has(text)) return
      if (text === 'function') {
        functionNext = true
        return
      }
    }
    current.words.push(text)
  }
  const extend = (text: string) => {
    word = (word ?? '') + text
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    const next = text[index + 1]
    if (char === '\\') {
      if (next === '\n') flushWord()
      else extend(text.slice(index, index + 2))
      index += 1
    } else if (char === '#' && word === undefined) {
      const eol = text.indexOf('\n', index)
      index = (eol === -1 ? text.length : eol) - 1
    } else if (char === '"' || char === "'") {
      const segment = quotedAt(text, index)
      if (!segment) {
        extend(text.slice(index))
        break
      }
      current.segments.push(segment)
      extend(text.slice(index, segment.end + 1))
      index = segment.end
    } else if (char === '<' && next === '<' && text[index + 2] !== '<') {
      let cursor = index + 2
      const strip = text[cursor] === '-'
      if (strip) cursor += 1
      while (text[cursor] === ' ' || text[cursor] === '\t') cursor += 1
      const from = cursor
      while (cursor < text.length && !/[\s;&|()<>]/u.test(text[cursor]!)) cursor += 1
      heredocs.push({ delimiter: text.slice(from, cursor).replaceAll(/['"\\]/gu, ''), strip })
      extend(text.slice(index, cursor))
      index = cursor - 1
    } else if (char === '&' && (/[<>]/u.test(text[index - 1] ?? '') || next === '>')) {
      extend(char) // `>&2`, `<&0` and `&>file` are redirections, not separators
    } else if (char === '(') {
      if (word !== undefined && /[$<>]$/u.test(word)) {
        end(false)
        open('$(')
      } else if (word !== undefined && emptyParensAt(text, index + 1)) {
        end(false)
        functionNext = true
        index = text.indexOf(')', index)
      } else open('(')
    } else if (char === ')') {
      flushWord()
      const top = stack.at(-1)?.kind
      if (top === '(') close('(')
      else if (top === '$(') {
        end(false)
        stack.pop()
        start(false)
        current.continued = true
      } else end(false) // a case pattern
    } else if (char === '`') {
      if (stack.at(-1)?.kind === '`') {
        end(false)
        stack.pop()
        start(false)
        current.continued = true
      } else open('`')
    } else if (char === '|') {
      if (next === '|') end(false)
      else end(true)
      if (next === '|' || next === '&') index += 1
    } else if (char === ';' || char === '&') {
      end(false)
      if (next === char) index += 1
    } else if (char === '\n') {
      end(false)
      let cursor = index + 1
      for (const heredoc of heredocs.splice(0)) {
        for (;;) {
          if (cursor >= text.length) break
          const eol = text.indexOf('\n', cursor)
          const lineEnd = eol === -1 ? text.length : eol
          const line = text.slice(cursor, lineEnd)
          cursor = lineEnd + 1
          if ((heredoc.strip ? line.replace(/^\t+/u, '') : line) === heredoc.delimiter) break
        }
      }
      index = cursor - 1
    } else if (/\s/u.test(char)) flushWord()
    else extend(char)
  }
  end(false)
  return commands
}

const redirectsOnlyToStderr = (words: readonly string[]) =>
  words.every((word) => TO_STDERR.test(word.replaceAll(QUOTED_PART, '')))

/**
 * Whether a command's quoted arguments reach stderr and nothing else: `echo`
 * or `printf` with an explicit `>&2`/`1>&2`, no other redirection, in no
 * pipeline, and inside no function body, command substitution or group whose
 * own output is piped or redirected elsewhere.
 */
function printsOnlyToStderr(command: ShellCommand): boolean {
  const [printer, ...rest] = command.words
  if (!PRINTERS.has(printer ?? '') || command.piped || command.tailOf || command.continued)
    return false
  if (printer === 'printf' && rest.some((word) => /^-\w*v/u.test(word))) return false // `printf -v NAME` assigns
  let toStderr = false
  for (const word of command.words) {
    const bare = word.replaceAll(QUOTED_PART, '')
    if (TO_STDERR.test(bare)) toStderr = true
    else if (/[<>]/u.test(bare)) return false
  }
  return (
    toStderr &&
    command.groups.every(
      (group) =>
        TRANSPARENT_GROUPS.has(group.kind) &&
        !group.functionBody &&
        !group.piped &&
        group.tail !== undefined &&
        redirectsOnlyToStderr(group.tail),
    )
  )
}

/** Quoted shell strings that are only printed to stderr; a string that expands code or spans lines is not one. */
function shellMessages(text: string): QuotedSegment[] {
  return shellCommands(text)
    .filter(printsOnlyToStderr)
    .flatMap((command) => command.segments)
    .filter(
      (segment) =>
        !segment.content.includes('\n') &&
        !(segment.quote === '"' && /`|\$[([{]/u.test(segment.content)),
    )
}

/** Whether a JS file's message literals can only be printed: it loads nothing and rewires nothing. */
function javascriptFileMessages(text: string): boolean {
  if (JAVASCRIPT_REWIRING.test(text)) return false
  return (text.match(CONSOLE_USE)?.length ?? 0) === (text.match(CONSOLE_CALL)?.length ?? 0)
}

/** JS message literals on one line: the first argument of console.error/warn or `throw new Error(…)`. */
function javascriptMessages(line: string, offset: number): QuotedSegment[] {
  return javascriptStrings(line)
    .filter(
      (segment) =>
        !(segment.quote === '`' && segment.content.includes('${')) &&
        MESSAGE_CALL.test(line.slice(0, segment.start)),
    )
    .map((segment) => ({ ...segment, start: segment.start + offset, end: segment.end + offset }))
}

interface MessageScope {
  shell: boolean
  javascript: boolean
  /** Whether something that can read a child's stderr may run this script name or file. */
  capturable: (token: string) => boolean
}

const NO_MESSAGES: MessageScope = { shell: false, javascript: false, capturable: () => true }

/**
 * Whether messages in this scope can be excused at all. Every script and
 * scanned file is a possible caller: a script that captures stderr, sources
 * code, redefines a printer or preloads node code could run what a message
 * prints, and a pnpm script-shell setting replaces the shell every script
 * runs in. A JS file that can read a child's stderr withdraws the excuse from
 * any script or file it, or the script running it, names.
 */
function messageScope(
  configs: readonly string[],
  texts: ReadonlyMap<string, string>,
  runs: ReadonlyArray<{ command: string; files: readonly string[] }>,
): MessageScope {
  if (configs.some((text) => SCRIPT_SHELL.test(text))) return NO_MESSAGES
  const shell: string[] = []
  const capturing = new Map<string, string>()
  for (const [origin, text] of texts) {
    const stderrCaptured = STDERR_CAPTURE.test(text.replaceAll(DISCARD, ''))
    if (!JAVASCRIPT.test(origin)) {
      if (stderrCaptured) return NO_MESSAGES
      shell.push(text)
    } else if (stderrCaptured || JAVASCRIPT_CAPTURE.test(text)) capturing.set(origin, text)
  }
  const callers = [
    ...capturing.values(),
    ...runs
      .filter((run) => run.files.some((file) => capturing.has(file)))
      .map((run) => run.command),
  ]
  return {
    shell: !shell.some((text) => SHELL_REWIRING.test(text)),
    javascript: !shell.some((text) => NODE_PRELOAD.test(text)),
    capturable: (token) => {
      const escaped = token.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`)
      const mention = new RegExp(`(?<![\\w:.-])${escaped}(?![\\w:-])`, 'u')
      return callers.some((text) => mention.test(text))
    },
  }
}

/** The name an override setter on this line arms, if any. */
function setterIn(
  line: string,
  offset: number,
  messages: readonly QuotedSegment[],
): string | undefined {
  const assignment = DEFAULT_ASSIGN.exec(line)
  if (assignment) return assignment[1]
  for (const match of line.matchAll(OVERRIDE_VALUE)) {
    if (/\$\{?$/u.test(line.slice(0, match.index))) continue // a reader: `$NAME`, `${NAME:-…}`
    const start = offset + match.index
    const end = start + match[0].length
    if (messages.some((segment) => segment.start < start && end <= segment.end)) continue
    return match[1]
  }
  return undefined
}

/**
 * The first line that sets an override, skipping whole-line comments. Every
 * match of the broad net counts except a reader and, when `messages` allows,
 * a match wholly inside a message printed to stderr. A string run as a
 * command (`sh -c '…'`, `execSync("…")`) is never a message.
 */
function armedOverride(
  text: string,
  javascript: boolean,
  messages: boolean,
): { name: string; line: number } | undefined {
  const exempt = messages && !javascript ? shellMessages(text) : []
  let offset = 0
  for (const [index, raw] of text.split('\n').entries()) {
    const lineOffset = offset
    offset += raw.length + 1
    const line = javascript
      ? raw.replaceAll(/\/\*.*?\*\//gu, (comment) => ' '.repeat(comment.length))
      : raw
    const trimmed = line.trimStart()
    if (javascript ? trimmed.startsWith('//') : trimmed.startsWith('#')) continue
    const lineMessages = javascript
      ? messages
        ? javascriptMessages(line, lineOffset)
        : []
      : exempt
    const name = setterIn(line, lineOffset, lineMessages)
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
  }
  const runs: Array<{ pkg: WorkspacePackage; name: string; command: string; files: string[] }> = []
  const texts = new Map<string, string>()
  for (const pkg of packages)
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (typeof command !== 'string') continue
      const files = referencedFiles(command, pkg.directory, checkout)
      runs.push({ pkg, name, command, files })
      texts.set(`${pkg.rel}#${name}`, command)
      for (const file of files) texts.set(file, readFileSync(file, 'utf8'))
    }
  const configs = [resolve(checkout), ...packages.map((pkg) => pkg.directory)]
    .flatMap((directory) =>
      ['.npmrc', 'pnpm-workspace.yaml'].map((file) => resolve(directory, file)),
    )
    .filter((file) => existsSync(file) && statSync(file).isFile())
    .map((file) => readFileSync(file, 'utf8'))
  const scope = messageScope(configs, texts, runs)
  for (const { pkg, name, command, files } of runs) {
    const at = (reason: string) => findings.push({ packageJson: pkg.rel, script: name, reason })
    const inline = armedOverride(command, false, scope.shell && !scope.capturable(name))
    if (inline) {
      at(`sets ${inline.name}, a workstation publish override`)
      continue
    }
    for (const file of files) {
      const text = texts.get(file)!
      const javascript = JAVASCRIPT.test(file)
      const messages =
        (javascript ? scope.javascript && javascriptFileMessages(text) : scope.shell) &&
        !scope.capturable(basename(file))
      const armed = armedOverride(text, javascript, messages)
      if (!armed) continue
      at(
        `runs ${relative(checkout, file).split(sep).join('/')}, which sets ${armed.name} (line ${armed.line})`,
      )
      break
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
