import { describe, expect, it } from 'vitest'

import { normalizeCspReports } from '../runtime/server/handlers/cspReport.post'

describe('report-uri envelope (application/csp-report)', () => {
  it('unwraps the csp-report object browsers actually send', () => {
    expect(
      normalizeCspReports({
        'csp-report': {
          'document-uri': 'https://app.example/stations',
          'effective-directive': 'script-src',
          'blocked-uri': 'https://evil.example/x.js',
          'disposition': 'report',
          'source-file': 'https://app.example/stations',
          'line-number': 42,
        },
      }),
    ).toEqual([
      {
        documentUri: 'https://app.example/stations',
        effectiveDirective: 'script-src',
        blockedUri: 'https://evil.example/x.js',
        disposition: 'report',
        sourceFile: 'https://app.example/stations',
        lineNumber: 42,
      },
    ])
  })

  it('accepts the deprecated violated-directive spelling Firefox sent for years', () => {
    const [report] = normalizeCspReports({ 'csp-report': { 'violated-directive': 'img-src' } })
    expect(report?.effectiveDirective).toBe('img-src')
  })

  it('defaults disposition to report, which is what a soak produces', () => {
    const [report] = normalizeCspReports({ 'csp-report': { 'effective-directive': 'img-src' } })
    expect(report?.disposition).toBe('report')
  })

  it('accepts a bare body for a client that omits the wrapper', () => {
    const [report] = normalizeCspReports({ 'effective-directive': 'connect-src' })
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
        body: { 'effective-directive': 'script-src', 'blocked-uri': 'inline' },
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
        { type: 'deprecation', body: { 'effective-directive': 'script-src' } },
        { type: 'intervention', body: { 'effective-directive': 'script-src' } },
      ]),
    ).toEqual([])
  })
})

describe('hostile and malformed input', () => {
  it('drops a report with no directive rather than logging an empty line', () => {
    expect(normalizeCspReports({ 'csp-report': { 'blocked-uri': 'https://x.example' } })).toEqual([])
  })

  it('ignores a non-object payload', () => {
    expect(normalizeCspReports(null)).toEqual([])
    expect(normalizeCspReports('nope')).toEqual([])
    expect(normalizeCspReports(7)).toEqual([])
  })

  it('caps a batch so one request cannot flood the log', () => {
    const batch = Array.from({ length: 200 }, () => ({
      type: 'csp-violation',
      body: { 'effective-directive': 'script-src' },
    }))
    expect(normalizeCspReports(batch)).toHaveLength(20)
  })

  it('truncates an oversized field instead of writing a page into the log', () => {
    const [report] = normalizeCspReports({
      'csp-report': { 'effective-directive': 'script-src', 'source-file': 'x'.repeat(5000) },
    })
    expect(report?.sourceFile).toHaveLength(513)
    expect(report?.sourceFile.endsWith('…')).toBe(true)
  })

  it('refuses a non-integer or negative line number', () => {
    const [report] = normalizeCspReports({
      'csp-report': { 'effective-directive': 'script-src', 'line-number': -1 },
    })
    expect(report?.lineNumber).toBeUndefined()
  })
})
