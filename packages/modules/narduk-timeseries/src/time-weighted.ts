/**
 * The time-weighted mean of a change-only series, in memory -- the reference
 * the SQL refresh in `./timescale/time-weighted.ts` is proven equal to.
 *
 * A change-only series writes a value when it changes (plus a heartbeat) and
 * the value HOLDS until the next row. A sample mean counts each row once and
 * so over-weights a value that changed often and under-weights one that held:
 * 10 for 50 s then 20 for 10 s is two rows, a sample mean of 15, and a
 * time-weighted mean of (10 * 50 + 20 * 10) / 60 = 11.67.
 *
 * The rules, identical in the SQL:
 *
 *  - Row i holds over `[ts_i, min(ts_{i+1}, ts_i + maxHoldMs))`. A gap longer
 *    than `maxHoldMs` is no data, not a held value.
 *  - Held time is split at bucket boundaries, so every bucket carries exactly
 *    its own integral and a coarser bucket is the sum of its finer ones.
 *  - A bucket's mean is `weightedSum / heldMs` over the covered time only.
 *  - Only the window `[range.start, range.end)` is reported; a row before the
 *    window whose hold reaches into it is carried in.
 *
 * It lives in the root entry because it carries no SQL. A consumer reading
 * raw rows for a short range can call it directly.
 */
import { NardukTimeseriesError } from './errors.js'
import type { TimeRange } from './types.js'

export interface TimeWeightedReading {
  ts: Date
  value: number
}

export interface TimeWeightedBucket {
  /** Inclusive. */
  start: Date
  /** Covered milliseconds. */
  heldMs: number
  last: number
  max: number
  /** `weightedSum / heldMs`. */
  mean: number
  min: number
  /** Readings that started in the bucket. */
  n: number
  /** Value times milliseconds held, summed. */
  weightedSum: number
}

export interface TimeWeightedBucketsOptions {
  bucketMs: number
  maxHoldMs: number
  /** Bucket-aligned on `bucketMs` from the epoch, as `time_bucket` is. */
  range: TimeRange
}

function assertPositive(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new NardukTimeseriesError('RANGE_INVALID', `${label} must be a positive number.`, {
      label,
      value,
    })
  }
}

/**
 * Time-weighted buckets over `range`, from readings in any order (one series).
 * Buckets with no covered time are absent. Readings that share a timestamp
 * keep the last one given, as a redelivery would leave one row.
 */
export function timeWeightedBuckets(
  readings: readonly TimeWeightedReading[],
  options: TimeWeightedBucketsOptions,
): TimeWeightedBucket[] {
  const { bucketMs, maxHoldMs, range } = options
  assertPositive('bucketMs', bucketMs)
  assertPositive('maxHoldMs', maxHoldMs)
  const windowStart = range.start.getTime()
  const windowEnd = range.end.getTime()
  if (!(windowEnd > windowStart)) {
    throw new NardukTimeseriesError('RANGE_INVALID', 'range.end must be after range.start.')
  }

  const byTs = new Map<number, number>()
  for (const reading of readings) {
    const ts = reading.ts.getTime()
    if (Number.isFinite(ts) && Number.isFinite(reading.value)) byTs.set(ts, reading.value)
  }
  const sorted = [...byTs.entries()].sort((left, right) => left[0] - right[0])

  const buckets = new Map<number, TimeWeightedBucket>()
  for (let index = 0; index < sorted.length; index += 1) {
    const [ts, value] = sorted[index]!
    const next = sorted[index + 1]?.[0] ?? Number.POSITIVE_INFINITY
    const start = Math.max(ts, windowStart)
    const end = Math.min(next, ts + maxHoldMs, windowEnd)
    if (!(end > start)) continue
    for (let bucket = Math.floor(start / bucketMs) * bucketMs; bucket < end; bucket += bucketMs) {
      const held = Math.min(end, bucket + bucketMs) - Math.max(start, bucket)
      if (held <= 0) continue
      let row = buckets.get(bucket)
      if (!row) {
        row = {
          heldMs: 0,
          last: value,
          max: value,
          mean: 0,
          min: value,
          n: 0,
          start: new Date(bucket),
          weightedSum: 0,
        }
        buckets.set(bucket, row)
      }
      row.heldMs += held
      row.weightedSum += value * held
      row.min = Math.min(row.min, value)
      row.max = Math.max(row.max, value)
      // Pieces arrive in time order, so the latest one written is the last.
      row.last = value
      if (ts >= bucket && ts < bucket + bucketMs) row.n += 1
    }
  }

  const rows = [...buckets.values()].sort(
    (left, right) => left.start.getTime() - right.start.getTime(),
  )
  for (const row of rows) row.mean = row.weightedSum / row.heldMs
  return rows
}
