import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { main } from '../src/cli.js'
import {
  INVALID_HOST_MESSAGE,
  INVALID_PORT_MESSAGE,
  KEEP_SERVICE_BINDINGS_ENV,
  MISSING_WRANGLER_MESSAGE,
  collectServiceBindings,
  formatDroppedServiceBinding,
  isKeepServiceBindings,
  materializeE2eServeWranglerConfig,
  parseE2eServeArgs,
  stripServiceBindings,
} from '../src/e2e-serve/e2e-serve.js'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function writeJson(dir: string, name: string, value: unknown): void {
  writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`)
}

function capturedErrors(): string[] {
  const lines: string[] = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  })
  return lines
}

describe('e2e-serve argument and host validation', () => {
  it('requires a TCP port in 1..65535', () => {
    expect(() => parseE2eServeArgs([])).toThrow(INVALID_PORT_MESSAGE)
    expect(() => parseE2eServeArgs(['0'])).toThrow(INVALID_PORT_MESSAGE)
    expect(() => parseE2eServeArgs(['65536'])).toThrow(INVALID_PORT_MESSAGE)
    expect(() => parseE2eServeArgs(['nope'])).toThrow(INVALID_PORT_MESSAGE)
  })

  it('refuses any host other than 127.0.0.1', () => {
    expect(() => parseE2eServeArgs(['4401'], { E2E_HOST: '0.0.0.0' })).toThrow(INVALID_HOST_MESSAGE)
    expect(() => parseE2eServeArgs(['4401'], { E2E_HOST: 'localhost' })).toThrow(
      INVALID_HOST_MESSAGE,
    )
  })

  it('defaults to the narduk-app layout and accepts path flags', () => {
    const root = tempDir('narduk-e2e-serve-layout-')
    mkdirSync(join(root, 'apps', 'web'), { recursive: true })
    writeJson(join(root, 'apps', 'web'), 'wrangler.json', { name: 'fixture' })

    expect(parseE2eServeArgs(['4401'], {}, root)).toMatchObject({
      port: 4401,
      host: '127.0.0.1',
      appDir: join(root, 'apps', 'web'),
      entrypoint: join(root, 'apps', 'web', '.output', 'server', 'index.mjs'),
      config: join(root, 'apps', 'web', 'wrangler.json'),
    })

    const flags = parseE2eServeArgs(
      [
        '--entrypoint',
        'built/worker.mjs',
        '--config',
        'wrangler.jsonc',
        '--assets',
        'public',
        '8080',
      ],
      {},
      root,
    )
    expect(flags).toMatchObject({
      port: 8080,
      entrypoint: join(root, 'built', 'worker.mjs'),
      config: join(root, 'wrangler.jsonc'),
      assets: join(root, 'public'),
    })
  })

  it('rejects unknown flags', () => {
    expect(() => parseE2eServeArgs(['4401', '--watch'])).toThrow(
      'Unknown e2e-serve option: --watch',
    )
  })
})

describe('e2e-serve service bindings', () => {
  it('strips top-level and env-scoped services and names each drop', () => {
    const { config, dropped } = stripServiceBindings({
      name: 'loadtest-dev',
      services: [{ binding: 'ENGINE', service: 'loadtest-dev-engine' }],
      env: {
        production: {
          name: 'loadtest-dev-production',
          services: [{ binding: 'OTHER', service: 'other-engine' }],
        },
      },
    })

    expect(config.services).toBeUndefined()
    expect(config.env).toEqual({
      production: { name: 'loadtest-dev-production' },
    })
    expect(dropped).toEqual([
      { binding: 'ENGINE', service: 'loadtest-dev-engine' },
      { binding: 'OTHER', service: 'other-engine' },
    ])
    expect(formatDroppedServiceBinding(dropped[0]!)).toBe(
      'dropping service binding ENGINE (service loadtest-dev-engine)',
    )
  })

  it('collects nothing when the config has no services', () => {
    expect(collectServiceBindings({ name: 'fixture' })).toEqual([])
    expect(stripServiceBindings({ name: 'fixture' }).dropped).toEqual([])
  })

  it('writes a sibling config without services and leaves the original file', () => {
    const root = tempDir('narduk-e2e-serve-services-config-')
    writeFileSync(
      join(root, 'wrangler.jsonc'),
      `{
  "name": "loadtest-dev",
  // comment kept only in the source file
  "services": [{ "binding": "ENGINE", "service": "loadtest-dev-engine" }]
}
`,
    )

    const prepared = materializeE2eServeWranglerConfig(join(root, 'wrangler.jsonc'), {
      pid: 4242,
    })

    expect(prepared.derived).toBe(true)
    expect(prepared.configPath).toBe(join(root, '.wrangler.e2e.4242.json'))
    expect(prepared.dropped).toEqual([{ binding: 'ENGINE', service: 'loadtest-dev-engine' }])
    expect(JSON.parse(readFileSync(prepared.configPath, 'utf8'))).toEqual({ name: 'loadtest-dev' })
    expect(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')).toContain('"services"')
  })

  it(`leaves the source config in place when ${KEEP_SERVICE_BINDINGS_ENV} is set`, () => {
    const root = tempDir('narduk-e2e-serve-keep-services-')
    writeJson(root, 'wrangler.json', {
      name: 'loadtest-dev',
      services: [{ binding: 'ENGINE', service: 'loadtest-dev-engine' }],
    })
    const source = join(root, 'wrangler.json')

    expect(isKeepServiceBindings({ [KEEP_SERVICE_BINDINGS_ENV]: '1' })).toBe(true)
    const prepared = materializeE2eServeWranglerConfig(source, { keepServiceBindings: true })
    expect(prepared).toEqual({ configPath: source, dropped: [], derived: false })
    expect(existsSync(join(root, '.wrangler.e2e.4242.json'))).toBe(false)
  })
})

describe('e2e-serve refusal paths', () => {
  it('fails with one line when the prebuilt artifact is missing', async () => {
    const root = tempDir('narduk-e2e-serve-missing-artifact-')
    writeJson(root, 'wrangler.json', { name: 'fixture' })
    writeJson(root, 'package.json', { name: 'fixture', type: 'module' })
    const lines = capturedErrors()

    const code = await main(['e2e-serve', '4401', '--cwd', root])
    expect(code).toBe(1)
    expect(lines.some((line) => line.includes('Prebuilt Worker artifact not found'))).toBe(true)
    expect(lines.some((line) => line.includes('will not build a fallback'))).toBe(true)
  })

  it('fails with one line when wrangler is not installed in the app', async () => {
    const root = tempDir('narduk-e2e-serve-missing-wrangler-')
    writeJson(root, 'wrangler.json', { name: 'fixture' })
    writeJson(root, 'package.json', { name: 'fixture', type: 'module' })
    mkdirSync(join(root, '.output', 'server'), { recursive: true })
    writeFileSync(join(root, '.output', 'server', 'index.mjs'), 'export default {}\n')
    const lines = capturedErrors()

    const code = await main(['e2e-serve', '4401', '--cwd', root])
    expect(code).toBe(1)
    expect(lines).toEqual([MISSING_WRANGLER_MESSAGE])
  })
})

describe('e2e-serve real worker start', () => {
  it('serves a request from a tiny fixture worker and shuts down by PID', async () => {
    const root = tempDir('narduk-e2e-serve-real-')
    writeFixtureWorker(root)
    linkWorkspaceWrangler(root)
    const port = await allocatePort()
    const child = spawn(process.execPath, [ensureBuiltBin(), 'e2e-serve', String(port)], {
      cwd: root,
      env: { ...process.env, E2E_HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const pid = child.pid
    expect(pid).toEqual(expect.any(Number))

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    try {
      await waitForReady(child, () => stderr, port)
      expect(stderr).toContain('[e2e-serve] cwd=')
      expect(stderr).toContain(`[e2e-serve] ready on http://127.0.0.1:${String(port)}`)

      const response = await fetch(`http://127.0.0.1:${String(port)}/`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('e2e-serve-fixture-ok')
    } finally {
      if (pid !== undefined) {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // Already exited.
        }
      }
      await waitForExit(child)
    }

    expect(
      child.exitCode === 0 ||
        child.exitCode === 143 ||
        child.signalCode === 'SIGTERM' ||
        child.signalCode === 'SIGINT',
      `e2e-serve teardown pid=${String(pid)} exit=${String(child.exitCode)} signal=${String(child.signalCode)} stderr=${stderr}`,
    ).toBe(true)
  }, 60_000)

  it('boots when wrangler.json declares a service binding', async () => {
    const root = tempDir('narduk-e2e-serve-service-binding-')
    writeFixtureWorker(root, {
      services: [{ binding: 'ENGINE', service: 'loadtest-dev-engine' }],
    })
    linkWorkspaceWrangler(root)
    const port = await allocatePort()
    const child = spawn(process.execPath, [ensureBuiltBin(), 'e2e-serve', String(port)], {
      cwd: root,
      env: { ...process.env, E2E_HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const pid = child.pid
    expect(pid).toEqual(expect.any(Number))

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    try {
      await waitForReady(child, () => stderr, port)
      expect(stderr).toContain(
        '[e2e-serve] dropping service binding ENGINE (service loadtest-dev-engine)',
      )
      expect(stderr).toContain(`[e2e-serve] ready on http://127.0.0.1:${String(port)}`)
      expect(stderr).not.toContain('no such service is defined')

      const response = await fetch(`http://127.0.0.1:${String(port)}/`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('e2e-serve-fixture-ok')
    } finally {
      if (pid !== undefined) {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // Already exited.
        }
      }
      await waitForExit(child)
      expect(existsSync(join(root, `.wrangler.e2e.${String(pid)}.json`))).toBe(false)
    }
  }, 60_000)
})

function ensureBuiltBin(): string {
  const bin = join(packageRoot, 'dist', 'bin.js')
  const result = spawnSync('pnpm', ['exec', 'tsc', '--project', 'tsconfig.build.json'], {
    cwd: packageRoot,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || 'tsc failed building e2e-serve for the start test',
    )
  }
  if (!existsSync(bin)) throw new Error(`e2e-serve start test expected ${bin}`)
  return bin
}

function writeFixtureWorker(
  root: string,
  extras: { services?: { binding: string; service: string }[] } = {},
): void {
  writeJson(root, 'package.json', {
    name: 'e2e-serve-fixture',
    type: 'module',
    dependencies: { wrangler: '*' },
  })
  writeJson(root, 'wrangler.json', {
    name: 'e2e-serve-fixture',
    main: '.output/server/index.mjs',
    compatibility_date: '2024-09-17',
    ...(extras.services ? { services: extras.services } : {}),
  })
  mkdirSync(join(root, '.output', 'server'), { recursive: true })
  writeFileSync(
    join(root, '.output', 'server', 'index.mjs'),
    'export default { fetch() { return new Response("e2e-serve-fixture-ok") } }\n',
  )
}

function linkWorkspaceWrangler(root: string): void {
  const requireFromTools = createRequire(join(packageRoot, 'package.json'))
  const wranglerPkg = dirname(requireFromTools.resolve('wrangler/package.json'))
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  symlinkSync(wranglerPkg, join(root, 'node_modules', 'wrangler'))
}

async function allocatePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not allocate an ephemeral e2e-serve port')
  }
  const { port } = address
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return port
}

async function waitForReady(
  child: ReturnType<typeof spawn>,
  readStderr: () => string,
  port: number,
): Promise<void> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `e2e-serve exited before ready (code=${String(child.exitCode)} signal=${String(child.signalCode)}): ${readStderr()}`,
      )
    }
    if (readStderr().includes(`ready on http://127.0.0.1:${String(port)}`)) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`e2e-serve did not become ready: ${readStderr()}`)
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    child.once('exit', () => resolve())
  })
}
