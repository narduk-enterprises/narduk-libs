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
import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRequestWebStream,
  isError,
  setResponseStatus,
} from 'h3'

import { useLogger } from '../utils/logger'
import { defineRateLimitedHandler } from '../utils/rateLimitedHandler'

import type { H3Event } from 'h3'

/** A report is diagnostics, not a document. Anything longer than this is a
 * page that pasted itself into `script-sample`, and truncating keeps one
 * misbehaving client from flooding the log. */
const MAX_FIELD_LENGTH = 512

/** A single navigation can legitimately produce a handful of violations; a
 * request claiming hundreds is noise or an attempt to fill the log. */
const MAX_REPORTS_PER_REQUEST = 20

/**
 * Byte ceiling for the raw report body. The sink is CSRF-exempt (browsers
 * POST `application/csp-report` with no `X-Requested-With`), so an unbounded
 * `readBody` is an unauthenticated parse. 64 KiB covers a Reporting API batch
 * of {@link MAX_REPORTS_PER_REQUEST} field-capped reports with room to spare.
 */
export const MAX_CSP_REPORT_BODY_BYTES = 64 * 1024

/**
 * The two media types a browser sends here (see the file header). Anything
 * else is not a browser report, so it is answered 204 without reading or
 * logging the body (narduk-libs#444, CSP-1).
 */
export const CSP_REPORT_CONTENT_TYPES: readonly string[] = [
  'application/csp-report',
  'application/reports+json',
]

/**
 * Per-client allowance for the sink. `report-uri` sends one POST per
 * violation, so a report-only soak on a busy page can legitimately produce a
 * few dozen a minute; a client far past that is filling the log. The key is
 * the `runtimeConfig.nardukRateLimit.routes` override for an app that needs
 * more (narduk-libs#444, CSP-1).
 */
export const CSP_REPORT_RATE_LIMIT = { key: 'csp-report', limit: 60, windowSeconds: 60 } as const

/** Is this `Content-Type` header one of {@link CSP_REPORT_CONTENT_TYPES}? */
export function isCspReportContentType(header: string | undefined): boolean {
  const mediaType = (header ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return CSP_REPORT_CONTENT_TYPES.includes(mediaType)
}

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

export function cspReportDeclaredLengthExceedsLimit(
  contentLengthHeader: string | undefined,
  maxBytes = MAX_CSP_REPORT_BODY_BYTES,
): boolean {
  if (contentLengthHeader === undefined || contentLengthHeader === '') return false
  const parsed = Number(contentLengthHeader)
  return Number.isInteger(parsed) && parsed > maxBytes
}

function payloadTooLargeError() {
  return createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
}

function chunkToBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk)
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk)
  return new Uint8Array()
}

function decodeUtf8Chunks(chunks: Uint8Array[]): string {
  let total = 0
  for (const chunk of chunks) total += chunk.byteLength
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

/**
 * Read the raw POST body with a hard byte ceiling. h3 1.15 `readRawBody` /
 * `readBody` have no limit, so this is the only cap on an unauthenticated
 * parse. Rejects 413 when `Content-Length` or the actual stream exceeds
 * {@link MAX_CSP_REPORT_BODY_BYTES}.
 */
export async function readCappedCspReportJson(
  event: H3Event,
  maxBytes = MAX_CSP_REPORT_BODY_BYTES,
): Promise<unknown> {
  if (cspReportDeclaredLengthExceedsLimit(getRequestHeader(event, 'content-length'), maxBytes)) {
    throw payloadTooLargeError()
  }

  const stream = getRequestWebStream(event)
  if (!stream) return null

  const chunks: Uint8Array[] = []
  let total = 0
  let overflow = false
  try {
    await stream.pipeTo(
      new WritableStream({
        write(chunk) {
          const bytes = chunkToBytes(chunk)
          total += bytes.byteLength
          if (total > maxBytes) {
            overflow = true
            throw payloadTooLargeError()
          }
          chunks.push(bytes)
        },
      }),
    )
  } catch (error) {
    if (overflow || (isError(error) && error.statusCode === 413)) {
      throw payloadTooLargeError()
    }
    throw error
  }

  if (chunks.length === 0) return null

  const raw = decodeUtf8Chunks(chunks)
  if (raw === '') return null
  return JSON.parse(raw) as unknown
}

const cspReportSink = defineRateLimitedHandler(async (event) => {
  const logger = useLogger(event).child('SecurityHeaders')

  let payload: unknown
  try {
    payload = await readCappedCspReportJson(event)
  } catch (error) {
    if (isError(error) && error.statusCode === 413) throw error
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
}, CSP_REPORT_RATE_LIMIT)

// Any other media type is answered before the limiter, so junk that is never
// read cannot spend the allowance a real report from the same client needs.
export default defineEventHandler((event) => {
  if (!isCspReportContentType(getRequestHeader(event, 'content-type'))) {
    setResponseStatus(event, 204)
    return null
  }
  return cspReportSink(event)
})
