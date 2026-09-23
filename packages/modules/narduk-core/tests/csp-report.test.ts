import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createApp, createEvent, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import cspReportHandler, {
  CSP_REPORT_RATE_LIMIT,
  cspReportDeclaredLengthExceedsLimit,
  isCspReportContentType,
  MAX_CSP_REPORT_BODY_BYTES,
  normalizeCspReports,
  readCappedCspReportJson,
} from '../runtime/server/handlers/cspReport.post'

const { logger } = vi.hoisted(() => {
  const logger = {
    warn: vi.fn(),
    child: () => logger,
  }
  return { logger }
})

vi.mock('../runtime/server/utils/logger', () => ({
  ensureRequestId: () => 'req-test',
  useLogger: () => logger,
}))

/** The wire spelling browsers actually send, as opposed to the camelCase one
 * the Reporting API spec drafts used. Named because it appears in almost every
 * case below. */
const DIRECTIVE = 'effective-directive'

/** The directive most of these cases violate. */
const SCRIPT_SRC = 'script-src'

const STATION_URL = 'https://app.example/stations'

describe('report-uri envelope (application/csp-report)', () => {
  it('unwraps the csp-report object browsers actually send', () => {
    expect(
      normalizeCspReports({
        'csp-report': {
          'document-uri': STATION_URL,
          [DIRECTIVE]: SCRIPT_SRC,
          'blocked-uri': 'https://evil.example/x.js',
          disposition: 'report',
          'source-file': STATION_URL,
          'line-number': 42,
        },
      }),
    ).toEqual([
      {
        documentUri: STATION_URL,
        effectiveDirective: 'script-src',
        blockedUri: 'https://evil.example/x.js',
        disposition: 'report',
        sourceFile: STATION_URL,
        lineNumber: 42,
      },
    ])
  })

  it('accepts the deprecated violated-directive spelling Firefox sent for years', () => {
    const [report] = normalizeCspReports({ 'csp-report': { 'violated-directive': 'img-src' } })
    expect(report?.effectiveDirective).toBe('img-src')
  })

  it('defaults disposition to report, which is what a soak produces', () => {
    const [report] = normalizeCspReports({ 'csp-report': { [DIRECTIVE]: 'img-src' } })
    expect(report?.disposition).toBe('report')
  })

  it('accepts a bare body for a client that omits the wrapper', () => {
    const [report] = normalizeCspReports({ [DIRECTIVE]: 'connect-src' })
    expect(report?.effectiveDirective).toBe('connect-src')
  })
})

describe('Reporting API envelope (application/reports+json)', () => {
  it('unwraps a batch of csp-violation reports', () => {
    const reports = normalizeCspReports([
      { type: 'csp-violation', url: 'https://app.example/', body: { effectiveDirective: 'a' } },
      {
        type: 'csp-violation',
        url: 'https://app.example/',
        body: { [DIRECTIVE]: SCRIPT_SRC, 'blocked-uri': 'inline' },
      },
    ])
    // The first entry uses the camelCase spelling no browser sends over the
    // wire, so it yields nothing rather than a half-populated line.
    expect(reports).toEqual([
      {
        documentUri: '',
        effectiveDirective: 'script-src',
        blockedUri: 'inline',
        disposition: 'report',
        sourceFile: '',
        lineNumber: undefined,
      },
    ])
  })

  it('ignores deprecation and intervention reports sharing the endpoint', () => {
    expect(
      normalizeCspReports([
        { type: 'deprecation', body: { [DIRECTIVE]: SCRIPT_SRC } },
        { type: 'intervention', body: { [DIRECTIVE]: SCRIPT_SRC } },
      ]),
    ).toEqual([])
  })
})

describe('hostile and malformed input', () => {
  it('drops a report with no directive rather than logging an empty line', () => {
    expect(normalizeCspReports({ 'csp-report': { 'blocked-uri': 'https://x.example' } })).toEqual(
      [],
    )
  })

  it('ignores a non-object payload', () => {
    expect(normalizeCspReports(null)).toEqual([])
    expect(normalizeCspReports('nope')).toEqual([])
    expect(normalizeCspReports(7)).toEqual([])
  })

  it('caps a batch so one request cannot flood the log', () => {
    const batch = Array.from({ length: 200 }, () => ({
      type: 'csp-violation',
      body: { [DIRECTIVE]: SCRIPT_SRC },
    }))
    expect(normalizeCspReports(batch)).toHaveLength(20)
  })

  it('truncates an oversized field instead of writing a page into the log', () => {
    const [report] = normalizeCspReports({
      'csp-report': { [DIRECTIVE]: SCRIPT_SRC, 'source-file': 'x'.repeat(5000) },
    })
    expect(report?.sourceFile).toHaveLength(513)
    expect(report?.sourceFile.endsWith('…')).toBe(true)
  })

  it('refuses a non-integer or negative line number', () => {
    const [report] = normalizeCspReports({
      'csp-report': { [DIRECTIVE]: SCRIPT_SRC, 'line-number': -1 },
    })
    expect(report?.lineNumber).toBeUndefined()
  })
})

describe('raw body ceiling', () => {
  afterEach(() => {
    logger.warn.mockClear()
  })

  it('rejects a Content-Length over 64 KiB before parsing', () => {
    expect(cspReportDeclaredLengthExceedsLimit(String(MAX_CSP_REPORT_BODY_BYTES))).toBe(false)
    expect(cspReportDeclaredLengthExceedsLimit(String(MAX_CSP_REPORT_BODY_BYTES + 1))).toBe(true)
    expect(cspReportDeclaredLengthExceedsLimit(undefined)).toBe(false)
  })

  it('throws 413 when Content-Length exceeds the cap without reading the stream', async () => {
    const request = new IncomingMessage(new Socket())
    request.method = 'POST'
    request.url = '/api/_security/csp-report'
    request.headers['content-length'] = String(MAX_CSP_REPORT_BODY_BYTES + 1)
    request.headers['content-type'] = 'application/csp-report'
    const event = createEvent(request, new ServerResponse(request))

    await expect(readCappedCspReportJson(event)).rejects.toMatchObject({ statusCode: 413 })
  })

  async function postReport(body: string, headers: Record<string, string> = {}): Promise<Response> {
    const app = createApp().use(cspReportHandler)
    const server = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
    try {
      return await fetch(`http://127.0.0.1:${address.port}/api/_security/csp-report`, {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report', ...headers },
        body,
      })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  }

  it('answers 204 for a real browser-sized report', async () => {
    const response = await postReport(
      JSON.stringify({
        'csp-report': {
          [DIRECTIVE]: SCRIPT_SRC,
          'document-uri': STATION_URL,
          'blocked-uri': 'inline',
        },
      }),
    )
    expect(response.status).toBe(204)
    expect(logger.warn).toHaveBeenCalledWith(
      'CSP violation',
      expect.objectContaining({ effectiveDirective: SCRIPT_SRC }),
    )
  })

  it('answers 413 when the raw body exceeds 64 KiB', async () => {
    const oversized = JSON.stringify({
      'csp-report': {
        [DIRECTIVE]: SCRIPT_SRC,
        'source-file': 'x'.repeat(MAX_CSP_REPORT_BODY_BYTES),
      },
    })
    expect(Buffer.byteLength(oversized)).toBeGreaterThan(MAX_CSP_REPORT_BODY_BYTES)

    const response = await postReport(oversized)
    expect(response.status).toBe(413)
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('what the sink accepts (narduk-libs#444, CSP-1)', () => {
  afterEach(() => {
    logger.warn.mockClear()
  })

  const report = JSON.stringify({ 'csp-report': { [DIRECTIVE]: SCRIPT_SRC } })

  async function post(
    count: number,
    contentType = 'application/csp-report',
  ): Promise<{ statuses: number[] }> {
    const app = createApp().use(cspReportHandler)
    const server = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
    const statuses: number[] = []
    try {
      for (let index = 0; index < count; index += 1) {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/_security/csp-report`, {
          body: report,
          headers: { 'content-type': contentType },
          method: 'POST',
        })
        statuses.push(response.status)
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
    return { statuses }
  }

  it('accepts only the two browser report media types, parameters and case aside', () => {
    expect(isCspReportContentType('application/csp-report')).toBe(true)
    expect(isCspReportContentType('application/reports+json; charset=utf-8')).toBe(true)
    expect(isCspReportContentType('Application/CSP-Report')).toBe(true)
    expect(isCspReportContentType('application/json')).toBe(false)
    expect(isCspReportContentType('text/plain')).toBe(false)
    expect(isCspReportContentType(undefined)).toBe(false)
  })

  it('answers 204 to any other content type and logs nothing', async () => {
    const { statuses } = await post(1, 'text/plain')
    expect(statuses).toEqual([204])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('answers 429 once a client passes its allowance, and logs nothing for the denial', async () => {
    const { statuses } = await post(CSP_REPORT_RATE_LIMIT.limit + 1)
    expect(statuses.at(-1)).toBe(429)
    const logged = logger.warn.mock.calls.filter(([message]) => message === 'CSP violation')
    expect(logged.length).toBe(statuses.filter((code) => code === 204).length)
  })
})
