/**
 * Serve an already-built Worker for Playwright (`E2E_PREBUILT_ARTIFACT=1`).
 *
 * Same contract as the Buoys `serve-e2e-build` launcher: prebuilt artifact
 * only (no compile fallback), 127.0.0.1 only, `[e2e-serve]` startup notes on
 * stderr, real worker errors passed through, and only the workerd client-abort
 * `Broken pipe` / `Connection reset by peer` block filtered
 * (buoys#124 / narduk-libs#447).
 *
 * `wrangler` is the app's dependency. This package resolves it from the app
 * cwd (optional peer) and fails with one line when it is missing.
 *
 * Service bindings whose target Worker is not in this process are stripped
 * from a sibling config before `unstable_startWorker` (narduk-libs#788).
 * Set `E2E_KEEP_SERVICE_BINDINGS=1` to pass the app config through.
 */

import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { readJsonc, resolveAppDir, resolveWranglerConfigPath } from '../deploy.js'
import {
  createWorkerdClientAbortFilterState,
  filterWorkerdClientAbort,
  flushWorkerdClientAbortFilter,
} from './filter-workerd-client-abort.js'

export const E2E_SERVE_NOTE_PREFIX = '[e2e-serve]'
export const MISSING_WRANGLER_MESSAGE =
  'wrangler is not installed in this app. Add it as a dependency and retry.'
export const INVALID_PORT_MESSAGE = 'A valid local E2E port is required.'
export const INVALID_HOST_MESSAGE = 'The local E2E worker must bind to 127.0.0.1.'
export const KEEP_SERVICE_BINDINGS_ENV = 'E2E_KEEP_SERVICE_BINDINGS'
export const E2E_SERVE_DERIVED_CONFIG_PREFIX = '.wrangler.e2e.'

const E2E_HOST = '127.0.0.1'
const WORKER_ENV_PREFIX = /^(?:NUXT_|NITRO_)/
const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

export interface E2eServiceBinding {
  binding: string
  service: string
}

export interface E2eServeOptions {
  port: number
  host: string
  cwd: string
  appDir: string
  entrypoint: string
  config: string
  assets: string | null
}

type PlainTextBinding = { type: 'plain_text'; value: string }

type StartedWorker = {
  ready: Promise<unknown>
  dispose: () => Promise<void>
}

type WranglerModule = {
  unstable_startWorker: (options: {
    config: string
    entrypoint: string
    assets?: string
    bindings?: Record<string, PlainTextBinding>
    dev: {
      remote: false
      server: { hostname: string; port: number }
      watch: false
    }
  }) => Promise<StartedWorker>
}

export function parseE2eServeArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): E2eServeOptions {
  let port: number | undefined
  let entrypointFlag: string | undefined
  let configFlag: string | undefined
  let assetsFlag: string | undefined
  let cwdFlag: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--entrypoint') {
      entrypointFlag = requireValue(args, (index += 1), '--entrypoint')
    } else if (arg === '--config') {
      configFlag = requireValue(args, (index += 1), '--config')
    } else if (arg === '--assets') {
      assetsFlag = requireValue(args, (index += 1), '--assets')
    } else if (arg === '--cwd') {
      cwdFlag = requireValue(args, (index += 1), '--cwd')
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown e2e-serve option: ${arg}`)
    } else if (port !== undefined) {
      throw new Error(`Unexpected e2e-serve argument: ${arg}`)
    } else {
      const parsed = Number(arg)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(INVALID_PORT_MESSAGE)
      }
      port = parsed
    }
  }

  if (port === undefined) throw new Error(INVALID_PORT_MESSAGE)

  const host = env.E2E_HOST ?? E2E_HOST
  if (host !== E2E_HOST) throw new Error(INVALID_HOST_MESSAGE)

  const resolvedCwd = resolve(cwdFlag ?? cwd)
  const appDir = resolveServeAppDir(resolvedCwd, configFlag)
  const entrypoint = resolveMaybeRelative(
    entrypointFlag ?? join(appDir, '.output', 'server', 'index.mjs'),
    resolvedCwd,
  )
  const config = resolveMaybeRelative(
    configFlag ?? resolveWranglerConfigPath(appDir) ?? '',
    resolvedCwd,
  )
  if (!config) {
    throw new Error(
      'Could not locate wrangler.jsonc or wrangler.json. Run from the app directory or repository root, or pass --config.',
    )
  }
  const defaultAssets = join(appDir, '.output', 'public')
  const assets = assetsFlag
    ? resolveMaybeRelative(assetsFlag, resolvedCwd)
    : existsSync(defaultAssets)
      ? defaultAssets
      : null

  return {
    port,
    host,
    cwd: resolvedCwd,
    appDir,
    entrypoint,
    config,
    assets,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readServiceList(value: unknown): E2eServiceBinding[] {
  if (!Array.isArray(value)) return []
  const out: E2eServiceBinding[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.binding !== 'string' || entry.binding.length === 0) {
      continue
    }
    out.push({
      binding: entry.binding,
      service: typeof entry.service === 'string' ? entry.service : '',
    })
  }
  return out
}

/** Named `services` entries on the top-level config and every `env.*` block. */
export function collectServiceBindings(config: unknown): E2eServiceBinding[] {
  if (!isRecord(config)) return []
  const out = readServiceList(config.services)
  if (!isRecord(config.env)) return out
  for (const value of Object.values(config.env)) {
    if (isRecord(value)) out.push(...readServiceList(value.services))
  }
  return out
}

function stripServicesKey(target: Record<string, unknown>): E2eServiceBinding[] {
  const dropped = readServiceList(target.services)
  delete target.services
  return dropped
}

/**
 * Drop `services` so `unstable_startWorker({ dev: { remote: false } })` can
 * boot when the target Worker is not in this process (narduk-libs#788).
 */
export function stripServiceBindings(config: Record<string, unknown>): {
  config: Record<string, unknown>
  dropped: E2eServiceBinding[]
} {
  const next: Record<string, unknown> = { ...config }
  const dropped = 'services' in next ? stripServicesKey(next) : []
  if (isRecord(next.env)) {
    const env: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(next.env)) {
      if (!isRecord(value) || !('services' in value)) {
        env[name] = value
        continue
      }
      const clone = { ...value }
      dropped.push(...stripServicesKey(clone))
      env[name] = clone
    }
    next.env = env
  }
  return { config: next, dropped }
}

export function isKeepServiceBindings(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[KEEP_SERVICE_BINDINGS_ENV]?.trim().toLowerCase()
  return Boolean(value && TRUTHY.has(value))
}

export function derivedE2eServeConfigPath(sourceConfig: string, pid = process.pid): string {
  return join(dirname(sourceConfig), `${E2E_SERVE_DERIVED_CONFIG_PREFIX}${String(pid)}.json`)
}

export function formatDroppedServiceBinding(dropped: E2eServiceBinding): string {
  return dropped.service
    ? `dropping service binding ${dropped.binding} (service ${dropped.service})`
    : `dropping service binding ${dropped.binding}`
}

/**
 * Point `unstable_startWorker` at a sibling config with `services` removed.
 * The original file is not rewritten. The derived file lives next to it so
 * relative `main` / assets / D1 paths still resolve.
 */
export function materializeE2eServeWranglerConfig(
  sourceConfigPath: string,
  options: { keepServiceBindings?: boolean; pid?: number } = {},
): { configPath: string; dropped: readonly E2eServiceBinding[]; derived: boolean } {
  if (options.keepServiceBindings) {
    return { configPath: sourceConfigPath, dropped: [], derived: false }
  }
  const source = readJsonc<unknown>(sourceConfigPath)
  if (!isRecord(source)) {
    return { configPath: sourceConfigPath, dropped: [], derived: false }
  }
  const dropped = collectServiceBindings(source)
  if (dropped.length === 0) {
    return { configPath: sourceConfigPath, dropped, derived: false }
  }
  const { config } = stripServiceBindings(source)
  const configPath = derivedE2eServeConfigPath(sourceConfigPath, options.pid)
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return { configPath, dropped, derived: true }
}

export async function importAppWrangler(cwd: string, appDir = cwd): Promise<WranglerModule> {
  const roots = uniqueRoots(cwd, appDir)
  for (const root of roots) {
    const entry = resolveWranglerEntry(root)
    if (!entry) continue
    return (await import(pathToFileURL(entry).href)) as WranglerModule
  }
  throw new Error(MISSING_WRANGLER_MESSAGE)
}

/** Only the app's own install. Do not walk out of `root` to a workspace wrangler. */
function resolveWranglerEntry(root: string): string | null {
  if (!existsSync(join(root, 'node_modules', 'wrangler', 'package.json'))) return null
  try {
    const requireFromApp = createRequire(join(root, 'package.json'))
    return requireFromApp.resolve('wrangler')
  } catch {
    return null
  }
}

export function installWorkerdClientAbortStderrFilter(): () => void {
  const abortNoise = createWorkerdClientAbortFilterState()
  const writeStderr = process.stderr.write.bind(process.stderr)

  process.stderr.write = ((
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) => {
    let encodingOrUndefined: BufferEncoding | undefined
    let done: ((error?: Error | null) => void) | undefined
    if (typeof encoding === 'function') {
      done = encoding
    } else {
      encodingOrUndefined = encoding
      done = callback
    }

    const text =
      typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk).toString(
            typeof encodingOrUndefined === 'string' ? encodingOrUndefined : 'utf8',
          )
    const filtered = filterWorkerdClientAbort(text, abortNoise)
    if (filtered.length === 0) {
      if (typeof done === 'function') {
        queueMicrotask(done)
      }
      return true
    }

    return writeStderr(filtered, encodingOrUndefined, done)
  }) as typeof process.stderr.write

  const flushAbortNoise = () => {
    const rest = flushWorkerdClientAbortFilter(abortNoise)
    if (rest.length > 0) {
      writeStderr(rest)
    }
    process.stderr.write = writeStderr
  }

  process.once('exit', flushAbortNoise)
  return () => {
    process.removeListener('exit', flushAbortNoise)
    flushAbortNoise()
  }
}

export async function runE2eServe(
  options: E2eServeOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const uninstall = installWorkerdClientAbortStderrFilter()
  const note = (message: string) => {
    process.stderr.write(`${E2E_SERVE_NOTE_PREFIX} ${message}\n`)
  }

  try {
    try {
      await access(options.entrypoint)
    } catch {
      throw new Error(
        `Prebuilt Worker artifact not found: ${options.entrypoint}. e2e-serve will not build a fallback.`,
      )
    }

    const wrangler = await importAppWrangler(options.cwd, options.appDir)

    note(`cwd=${options.cwd}`)
    note(`entrypoint=${options.entrypoint}`)

    const serverDir = dirname(options.entrypoint)
    try {
      const { files, bytes } = await walkFiles(serverDir)
      note(`server output: ${String(files)} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB`)
    } catch {
      note(`server output: could not scan ${serverDir}`)
    }

    const heartbeat = setInterval(() => note('still starting the worker...'), 15_000)
    heartbeat.unref()
    let derivedConfigPath: string | null = null
    const removeDerivedConfig = () => {
      if (!derivedConfigPath) return
      const path = derivedConfigPath
      derivedConfigPath = null
      try {
        unlinkSync(path)
      } catch {
        // Already removed or start failed before the write settled.
      }
    }
    process.once('exit', removeDerivedConfig)

    try {
      const prepared = materializeE2eServeWranglerConfig(options.config, {
        keepServiceBindings: isKeepServiceBindings(env),
      })
      if (prepared.derived) derivedConfigPath = prepared.configPath
      for (const dropped of prepared.dropped) {
        note(formatDroppedServiceBinding(dropped))
      }
      note('calling unstable_startWorker')

      const bindings = bindingsFromEnv(env)
      const worker = await wrangler.unstable_startWorker({
        config: prepared.configPath,
        entrypoint: options.entrypoint,
        ...(options.assets ? { assets: options.assets } : {}),
        ...(bindings ? { bindings } : {}),
        dev: {
          remote: false,
          server: { hostname: options.host, port: options.port },
          watch: false,
        },
      })

      note('worker constructed; awaiting ready')
      await worker.ready
      // watch is off; wrangler has already loaded the sibling config.
      removeDerivedConfig()
      clearInterval(heartbeat)
      note(`ready on http://${options.host}:${String(options.port)}`)

      await waitForShutdown(async () => {
        await worker.dispose()
      })
      return 0
    } finally {
      clearInterval(heartbeat)
      process.removeListener('exit', removeDerivedConfig)
      removeDerivedConfig()
    }
  } finally {
    uninstall()
  }
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index]
  if (!value || value.startsWith('-')) throw new Error(`${flag} requires a path`)
  return value
}

function resolveServeAppDir(cwd: string, configFlag: string | undefined): string {
  if (configFlag) return dirname(resolveMaybeRelative(configFlag, cwd))
  try {
    return resolveAppDir(cwd)
  } catch {
    return resolve(cwd)
  }
}

function resolveMaybeRelative(path: string, cwd: string): string {
  if (!path) return path
  return isAbsolute(path) ? path : resolve(cwd, path)
}

function uniqueRoots(...roots: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const root of roots) {
    const resolved = resolve(root)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    out.push(resolved)
  }
  return out
}

function bindingsFromEnv(env: NodeJS.ProcessEnv): Record<string, PlainTextBinding> | undefined {
  const bindings: Record<string, PlainTextBinding> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && WORKER_ENV_PREFIX.test(key)) {
      bindings[key] = { type: 'plain_text', value }
    }
  }
  return Object.keys(bindings).length > 0 ? bindings : undefined
}

async function walkFiles(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(child)
      } else {
        files += 1
        bytes += (await stat(child)).size
      }
    }
  }
  await walk(dir)
  return { files, bytes }
}

function waitForShutdown(onStop: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    let stopped = false
    const stop = () => {
      if (stopped) return
      stopped = true
      void onStop().then(() => resolve(), reject)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}
