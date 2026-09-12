/**
 * Failures from the history store, coded so a caller branches on the code and
 * never on the message. Connection- and protocol-level failures keep their
 * `NardukPostgresError` codes; these are the ones this layer owns.
 */

export const TIMESERIES_ERROR_CODES = [
  'BUCKET_UNKNOWN',
  'FLUX_UNSAFE',
  'INFLUX_WINDOW_INVALID',
  'RANGE_INVALID',
  'RETENTION_POLICY_INVALID',
  'SERIES_DESCRIPTOR_INVALID',
  'SERIES_UNRESOLVED',
  'VALUE_KIND_UNKNOWN',
  'WRITE_BATCH_INVALID',
] as const

export type TimeseriesErrorCode = (typeof TIMESERIES_ERROR_CODES)[number]

export class NardukTimeseriesError extends Error {
  readonly code: TimeseriesErrorCode
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: TimeseriesErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(`${code}: ${message}`, options)
    this.name = 'NardukTimeseriesError'
    this.code = code
    this.details = Object.freeze({ ...details })
  }
}

export function isNardukTimeseriesError(value: unknown): value is NardukTimeseriesError {
  return value instanceof NardukTimeseriesError
}
