/**
 * CSP violation report sink for the `security.headers` preset.
 *
 * Registered by `src/module.ts` with `addServerHandler` at whatever path
 * `security.headers.reportRoute` names, which is why it lives in `handlers/`
 * rather than `api/` -- `addServerScanDir` would otherwise bind it to a second,
 * fixed route as well.
 *
 * Violations are written through narduk-logging at `warn` and go nowhere else.
 * There is deliberately no external collector: a report body carries the
 * document URI and, for an inline violation, a sample of the offending source,
 * and shipping that to a third party is a data-egress decision nobody made.
 * Reading the soak means reading the app's own logs.
 *
 * Browsers send two different shapes at this endpoint and both are handled:
 *
 *   `application/csp-report`    the original single `{ "csp-report": {...} }`
 *                              object, which is what `report-uri` produces and
 *                              what Safari still sends.
 *   `application/reports+json`  the Reporting API batch, an array of
 *                              `{ type, url, body }` envelopes.
 */
import { defineEventHandler, readBody, setResponseStatus } from 'h3'

import { useLogger } from '../utils/logger'

/** A report is diagnostics, not a document. Anything longer than this is a
 * page that pasted itself into `script-sample`, and truncating keeps one
 * misbehaving client from flooding the log. */
const MAX_FIELD_LENGTH = 512

/** A single navigation can legitimately produce a handful of violations; a
 * request claiming hundreds is noise or an attempt to fill the log. */
const MAX_REPORTS_PER_REQUEST = 20

interface CspReportBody {
  'blocked-uri'?: unknown
  'column-number'?: unknown
  disposition?: unknown
  'document-uri'?: unknown
  'effective-directive'?: unknown
  'line-number'?: unknown
  'source-file'?: unknown
  'status-code'?: unknown
  'violated-directive'?: unknown
}

export interface NormalizedCspViolation {
  blockedUri: string
  disposition: string
  documentUri: string
  effectiveDirective: string
  lineNumber?: number
  sourceFile: string
}

function text(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > MAX_FIELD_LENGTH ? `${trimmed.slice(0, MAX_FIELD_LENGTH)}…` : trimmed
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function normalizeOne(report: CspReportBody): NormalizedCspViolation | null {
  // `violated-directive` is the deprecated spelling of `effective-directive`;
  // Chrome sends both, Firefox historically sent only the former.
  const effectiveDirective =
    text(report['effective-directive']) || text(report['violated-directive'])
  if (!effectiveDirective) return null
  return {
    blockedUri: text(report['blocked-uri']),
    // 'report' means the policy was report-only. During the soak that is every
    // violation, and it is the field that says so out loud.
    disposition: text(report.disposition) || 'report',
    documentUri: text(report['document-uri']),
    effectiveDirective,
    lineNumber: positiveInteger(report['line-number']),
    sourceFile: text(report['source-file']),
  }
}

/**
 * Pull the violations out of whichever envelope the browser used. Exported so
 * the shapes can be tested without a server: the parsing, not the logging, is
 * where this handler can actually be wrong.
 */
export function normalizeCspReports(payload: unknown): NormalizedCspViolation[] {
  const candidates: CspReportBody[] = []

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (!entry || typeof entry !== 'object') continue
      const envelope = entry as { body?: unknown; type?: unknown }
      // A Reporting API batch also carries deprecation and intervention
      // reports; only CSP violations belong in this log line.
      if (envelope.type !== undefined && envelope.type !== 'csp-violation') continue
      if (envelope.body && typeof envelope.body === 'object') {
        candidates.push(envelope.body as CspReportBody)
      }
    }
  } else if (payload && typeof payload === 'object') {
    const wrapped = (payload as { 'csp-report'?: unknown })['csp-report']
    candidates.push((wrapped && typeof wrapped === 'object' ? wrapped : payload) as CspReportBody)
  }

  return candidates
    .slice(0, MAX_REPORTS_PER_REQUEST)
    .map((report) => normalizeOne(report))
    .filter((report): report is NormalizedCspViolation => report !== null)
}

export default defineEventHandler(async (event) => {
  const logger = useLogger(event).child('SecurityHeaders')

  let payload: unknown
  try {
    payload = await readBody(event)
  } catch {
    // A malformed or empty body is a misbehaving client, not an app fault, and
    // answering 4xx would only teach it to retry.
    setResponseStatus(event, 204)
    return null
  }

  for (const violation of normalizeCspReports(payload)) {
    logger.warn('CSP violation', { ...violation })
  }

  // 204 keeps the browser from parsing or caching anything; a report endpoint
  // has no response worth reading.
  setResponseStatus(event, 204)
  return null
})
