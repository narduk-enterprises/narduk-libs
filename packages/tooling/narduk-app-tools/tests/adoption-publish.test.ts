import { describe, expect, it, vi } from 'vitest'

import { main } from '../src/cli.js'
import {
  ADOPTION_INGEST_DEFAULT_ORIGIN,
  ADOPTION_INGEST_TOKEN_ENV,
  ADOPTION_PUBLISH_EXIT,
  buildAdoptionIngestBody,
  parseAdoptionPublishArgs,
  runAdoptionPublish,
  scrubCredential,
} from '../src/commands/adoption-publish.js'
import { ADOPTION_TOOL_NAME } from '../src/foundation/evaluate-adoption.js'

// A deliberately fake key: long enough to be scrubbed, nothing like a real one.
const TOKEN = 'fixture-token-not-a-real-key'

function artefact(overrides: Record<string, unknown> = {}) {
  return {
    app: { commit: '48ba389bdb1b7ab8baadc17b8c234dcf426c7329', repo: 'example-org/example-app' },
    generated: '2026-10-04T12:00:00.000Z',
    requirements: [{ id: 'R1', verdict: 'pass' }],
    result: 'PASS',
    schemaVersion: 1,
    tool: ADOPTION_TOOL_NAME,
    toolVersion: '0.0.0-fixture',
    ...overrides,
  }
}

function harness(report: unknown, env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch) {
  const logs: string[] = []
  const errors: string[] = []
  return {
    deps: {
      env,
      error: (message: string) => errors.push(message),
      fetchImpl,
      log: (message: string) => logs.push(message),
      readFile: () => (typeof report === 'string' ? report : JSON.stringify(report)),
    },
    errors,
    logs,
  }
}

const flags = { dryRun: false, origin: null, reportPath: 'adoption.json' }

describe('parseAdoptionPublishArgs', () => {
  it('requires --report', () => {
    expect(() => parseAdoptionPublishArgs([])).toThrow('--report <adoption.json> is required')
  })

  it('reads --report, --origin and --dry-run', () => {
    expect(
      parseAdoptionPublishArgs(['--report', 'a.json', '--origin', 'https://x.test', '--dry-run']),
    ).toEqual({ dryRun: true, origin: 'https://x.test', reportPath: 'a.json' })
  })

  it('refuses the key on argv, naming the environment variable', () => {
    for (const args of [
      ['--report', 'a.json', '--token', TOKEN],
      ['--report', 'a.json', `--token=${TOKEN}`],
    ]) {
      const attempt = () => parseAdoptionPublishArgs(args)
      expect(attempt).toThrow(ADOPTION_INGEST_TOKEN_ENV)
      expect(attempt).not.toThrow(TOKEN)
    }
  })

  it('refuses an unknown option', () => {
    expect(() => parseAdoptionPublishArgs(['--report', 'a.json', '--nope'])).toThrow(
      'Unknown adoption publish option: --nope',
    )
  })
})

describe('buildAdoptionIngestBody', () => {
  it('wraps a schema-1 artefact as adoption_reports', () => {
    const report = artefact()
    expect(buildAdoptionIngestBody(report)).toEqual({ adoption_reports: [report] })
  })

  it.each([
    ['another tool', artefact({ tool: 'something-else' })],
    ['another schema', artefact({ schemaVersion: 2 })],
    ['no repository', artefact({ app: {} })],
    ['no requirements', artefact({ requirements: null })],
    ['null', null],
  ])('refuses %s', (_name, report) => {
    expect(() => buildAdoptionIngestBody(report)).toThrow()
  })
})

describe('scrubCredential', () => {
  it('removes the key wherever it appears', () => {
    expect(scrubCredential(`a ${TOKEN} b ${TOKEN}`, TOKEN)).toBe('a [credential] b [credential]')
  })
})

describe('runAdoptionPublish', () => {
  it('posts the body to the production origin with the key as a bearer', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"stored":1}', { status: 200 }))
    const { deps, logs } = harness(artefact(), { [ADOPTION_INGEST_TOKEN_ENV]: TOKEN }, fetchImpl)
    expect(await runAdoptionPublish(flags, deps)).toBe(ADOPTION_PUBLISH_EXIT.stored)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${ADOPTION_INGEST_DEFAULT_ORIGIN}/api/estate/ingest`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.parse(init.body as string)).toEqual({ adoption_reports: [artefact()] })
    expect(logs.join('\n')).toContain('example-org/example-app @ 48ba389bdb1b: PASS')
    expect(logs.join('\n')).toContain('stored: {"stored":1}')
    expect(logs.join('\n')).not.toContain(TOKEN)
  })

  it('takes --origin over OPERATOR_PORTAL_URL, and trims a trailing slash', async () => {
    const fetchImpl = vi.fn(async (_url: unknown) => new Response('ok', { status: 200 }))
    const env = { [ADOPTION_INGEST_TOKEN_ENV]: TOKEN, OPERATOR_PORTAL_URL: 'https://env.test' }
    const first = harness(artefact(), env, fetchImpl)
    await runAdoptionPublish({ ...flags, origin: 'https://flag.test//' }, first.deps)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://flag.test/api/estate/ingest')
    const second = harness(artefact(), env, fetchImpl)
    await runAdoptionPublish(flags, second.deps)
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://env.test/api/estate/ingest')
  })

  it('exits 2 and sends nothing when the key is missing or blank', async () => {
    for (const env of [{}, { [ADOPTION_INGEST_TOKEN_ENV]: '   ' }]) {
      const fetchImpl = vi.fn()
      const { deps, errors } = harness(artefact(), env, fetchImpl as unknown as typeof fetch)
      expect(await runAdoptionPublish(flags, deps)).toBe(ADOPTION_PUBLISH_EXIT.noToken)
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(errors.join('\n')).toContain(`${ADOPTION_INGEST_TOKEN_ENV} is not set`)
    }
  })

  it('exits 1 for an unreadable or non-adoption report, before looking at the key', async () => {
    const fetchImpl = vi.fn()
    for (const report of ['not json', artefact({ schemaVersion: 2 })]) {
      const { deps, errors } = harness(report, {}, fetchImpl as unknown as typeof fetch)
      expect(await runAdoptionPublish(flags, deps)).toBe(ADOPTION_PUBLISH_EXIT.badReport)
      expect(errors.join('\n')).toContain('is not a publishable adoption report')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('a dry run builds the body, needs no key and sends nothing', async () => {
    const fetchImpl = vi.fn()
    const { deps, logs } = harness(artefact(), {}, fetchImpl as unknown as typeof fetch)
    expect(await runAdoptionPublish({ ...flags, dryRun: true }, deps)).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(logs.join('\n')).toContain('dry run, nothing sent')
  })

  it('exits 3 when the portal refuses, and scrubs a key the response echoes', async () => {
    const fetchImpl = vi.fn(async () => new Response(`bad ${TOKEN}`, { status: 401 }))
    const { deps, errors } = harness(artefact(), { [ADOPTION_INGEST_TOKEN_ENV]: TOKEN }, fetchImpl)
    expect(await runAdoptionPublish(flags, deps)).toBe(ADOPTION_PUBLISH_EXIT.refused)
    expect(errors.join('\n')).toContain('HTTP 401')
    expect(errors.join('\n')).toContain('[credential]')
    expect(errors.join('\n')).not.toContain(TOKEN)
  })

  it('exits 3 when the portal cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${TOKEN}`)
    })
    const { deps, errors } = harness(artefact(), { [ADOPTION_INGEST_TOKEN_ENV]: TOKEN }, fetchImpl)
    expect(await runAdoptionPublish(flags, deps)).toBe(ADOPTION_PUBLISH_EXIT.refused)
    expect(errors.join('\n')).toContain('could not be reached: TypeError')
    expect(errors.join('\n')).not.toContain(TOKEN)
  })
})

describe('narduk-app adoption', () => {
  it('rejects a subcommand other than publish, exit 1', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await main(['adoption', 'nope'])).toBe(1)
      expect(error.mock.calls.join('\n')).toContain('Usage: narduk-app adoption publish')
    } finally {
      error.mockRestore()
    }
  })

  it('refuses the key on argv through the dispatcher, exit 1', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await main(['adoption', 'publish', '--report', 'a.json', '--token', TOKEN])).toBe(1)
      expect(error.mock.calls.join('\n')).not.toContain(TOKEN)
    } finally {
      error.mockRestore()
    }
  })
})
