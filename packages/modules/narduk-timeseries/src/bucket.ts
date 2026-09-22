/**
 * In-memory time bucketing: hourly, 3-hourly and daily min / avg / max over
 * rows a caller already holds (narduk-libs#528).
 *
 * The store's `queryRollup` answers the same question in the database, over a
 * fixed `1m | 15m | 1h | 1d` ladder in UTC. This is the other half: a page that
 * has an hour-grained history in hand and wants a 7-day table every three hours
 * or a 30-day table one line per day, **cut on the reader's calendar**, not on
 * UTC midnight. A "Fri, Sep 18" day row in Central time that actually opened at
 * 7 PM on Thursday would be a lie told by the grouping, not by the data.
 *
 * It lives in the root entry because it carries no SQL: a browser bundle can
 * import it without pulling in the adapter.
 *
 * ## What it promises
 *
 * - **One pass, no per-row awaits.** Work is `O(rows)` plus one bucket record
 *   per distinct bucket; the time-zone formatter is built once per call.
 * - **Missing is not zero.** A field with no finite value in a bucket reports
 *   `min`, `max` and `avg` as `null` and `n: 0` -- the same rule `RollupRow`
 *   states for the database path. `NaN`, `Infinity`, `null` and `undefined`
 *   are all "no value"; `0` is a value.
 * - **Calendar-true boundaries.** Buckets are floored on the wall clock of
 *   `timeZone` (default `UTC`) and converted back to instants, so a daily
 *   bucket across a DST change is 23 or 25 hours long, as the day was.
 * - **Rows with an unreadable time are skipped**, and counted in `skipped`, so
 *   a single malformed reading cannot throw a whole table away.
 */
import { NardukTimeseriesError } from './errors.js'

/** The grains a client table asks for. */
export type ReadingBucket = '1h' | '3h' | '1d'

export const READING_BUCKETS: readonly ReadingBucket[] = ['1h', '3h', '1d']

/** One field's summary inside one bucket. */
export interface BucketStats {
  avg: number | null
  max: number | null
  min: number | null
  /** How many finite values the bucket saw for this field. `0` means missing. */
  n: number
}

export interface ReadingBucketRow<TField extends string> {
  /** Exclusive: the next bucket's `start`. */
  end: Date
  /** Per-field summaries. Every requested field is present, missing or not. */
  fields: Record<TField, BucketStats>
  /**
   * The bucket's wall-clock label in `timeZone`: `2026-09-18` for `1d`,
   * `2026-09-18T15` for `1h` and `3h` (the hour the bucket opens). Stable, so
   * it doubles as a row key.
   */
  key: string
  /** Rows that fell in the bucket, whatever their field values. */
  rows: number
  /** Inclusive. */
  start: Date
}

export interface BucketReadingsOptions<TRow, TField extends string> {
  bucket: ReadingBucket
  /** One accessor per summarized field. */
  fields: Readonly<Record<TField, (row: TRow) => number | null | undefined>>
  /** Newest first (`'desc'`) for a history table; oldest first by default. */
  order?: 'asc' | 'desc'
  /** The reading's instant. A `Date`, epoch milliseconds or an ISO string. */
  time: (row: TRow) => Date | number | string | null | undefined
  /** IANA zone whose calendar the buckets follow. Defaults to `UTC`. */
  timeZone?: string
}

export interface BucketReadingsResult<TField extends string> {
  buckets: Array<ReadingBucketRow<TField>>
  /** Rows dropped because `time` returned nothing readable. */
  skipped: number
}

interface WallClock {
  day: number
  hour: number
  month: number
  year: number
}

const HOURS: Record<ReadingBucket, number> = { '1h': 1, '3h': 3, '1d': 24 }

function assertBucket(bucket: unknown): asserts bucket is ReadingBucket {
  if (!READING_BUCKETS.includes(bucket as ReadingBucket)) {
    throw new NardukTimeseriesError(
      'BUCKET_UNKNOWN',
      `bucketReadings: bucket must be one of ${READING_BUCKETS.join(', ')}.`,
      { bucket },
    )
  }
}

function createWallClockReader(timeZone: string): (ms: number) => WallClock & { offset: number } {
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone,
      year: 'numeric',
    })
  } catch (error) {
    throw new NardukTimeseriesError(
      'RANGE_INVALID',
      `bucketReadings: '${timeZone}' is not a time zone this runtime knows.`,
      { timeZone },
      { cause: error },
    )
  }

  return (ms) => {
    const parts: Record<string, number> = {}
    for (const part of format.formatToParts(new Date(ms))) {
      if (part.type !== 'literal') parts[part.type] = Number(part.value)
    }
    const wall = {
      day: parts.day ?? 1,
      hour: parts.hour ?? 0,
      month: parts.month ?? 1,
      year: parts.year ?? 1970,
    }
    const asUtc = Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      parts.minute ?? 0,
      parts.second ?? 0,
    )
    const wholeSecond = ms - (((ms % 1000) + 1000) % 1000)
    return { ...wall, offset: asUtc - wholeSecond }
  }
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

function readInstant(value: Date | number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Summarizes `rows` into `bucket`-grained min / avg / max per field.
 *
 * ```ts
 * const { buckets } = bucketReadings(readings, {
 *   bucket: '3h',
 *   timeZone: 'America/Chicago',
 *   time: (r) => r.observedAt,
 *   fields: { wind: (r) => r.windKt, pressure: (r) => r.pressureInHg },
 *   order: 'desc',
 * })
 * ```
 */
export function bucketReadings<TRow, TField extends string>(
  rows: readonly TRow[],
  options: BucketReadingsOptions<TRow, TField>,
): BucketReadingsResult<TField> {
  assertBucket(options.bucket)
  const timeZone = options.timeZone ?? 'UTC'
  const readWall = createWallClockReader(timeZone)
  const stepHours = HOURS[options.bucket]
  const fieldNames = Object.keys(options.fields) as TField[]

  /** Wall clock → instant, correcting once for an offset change in between. */
  function instantOf(wall: WallClock): number {
    const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour)
    const first = guess - readWall(guess).offset
    const second = readWall(first).offset
    return guess - second
  }

  interface Accumulator {
    end: number
    key: string
    rows: number
    start: number
    stats: Record<string, { max: number; min: number; n: number; sum: number }>
  }

  const byKey = new Map<string, Accumulator>()
  let skipped = 0

  for (const row of rows) {
    const ms = readInstant(options.time(row))
    if (ms === null) {
      skipped += 1
      continue
    }
    const wall = readWall(ms)
    const hour = options.bucket === '1d' ? 0 : wall.hour - (wall.hour % stepHours)
    const date = `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`
    const key = options.bucket === '1d' ? date : `${date}T${pad(hour)}`

    let bucket = byKey.get(key)
    if (!bucket) {
      const opening = { day: wall.day, hour, month: wall.month, year: wall.year }
      // The next bucket's wall clock, normalized through Date.UTC so hour 24
      // rolls into the next day and month-ends take care of themselves.
      const next = new Date(
        Date.UTC(opening.year, opening.month - 1, opening.day, opening.hour + stepHours),
      )
      bucket = {
        end: instantOf({
          day: next.getUTCDate(),
          hour: next.getUTCHours(),
          month: next.getUTCMonth() + 1,
          year: next.getUTCFullYear(),
        }),
        key,
        rows: 0,
        start: instantOf(opening),
        stats: {},
      }
      byKey.set(key, bucket)
    }
    bucket.rows += 1

    for (const name of fieldNames) {
      const value = options.fields[name](row)
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      const stat = bucket.stats[name]
      if (stat) {
        stat.n += 1
        stat.sum += value
        if (value < stat.min) stat.min = value
        if (value > stat.max) stat.max = value
      } else {
        bucket.stats[name] = { max: value, min: value, n: 1, sum: value }
      }
    }
  }

  const direction = options.order === 'desc' ? -1 : 1
  const buckets = [...byKey.values()]
    .sort((left, right) => direction * (left.start - right.start))
    .map((bucket) => {
      const fields = {} as Record<TField, BucketStats>
      for (const name of fieldNames) {
        const stat = bucket.stats[name]
        fields[name] = stat
          ? { avg: stat.sum / stat.n, max: stat.max, min: stat.min, n: stat.n }
          : { avg: null, max: null, min: null, n: 0 }
      }
      return {
        end: new Date(bucket.end),
        fields,
        key: bucket.key,
        rows: bucket.rows,
        start: new Date(bucket.start),
      }
    })

  return { buckets, skipped }
}
