const NAME_PATTERN = /^[\w-]{1,64}$/
const MAX_PHASES = 32
const MAX_DESCRIPTION_LENGTH = 128
/**
 * A rendered header stays under 2 KB. The phase cap alone does not bound bytes: 32 phases at the
 * full name and description length render about 5.6 KB, which is a real share of an edge's
 * response-header budget once cookies and a CSP are on the same response.
 */
const MAX_HEADER_BYTES = 2048
const SEPARATOR = ', '
/**
 * Everything outside printable ASCII, plus the `"`, `\` and `,` that would break the
 * `Server-Timing` grammar (a `desc` is a quoted-string inside a comma-separated header).
 *
 * The non-ASCII half is not cosmetic. A header value is a ByteString, so one character above
 * U+00FF makes `Headers.set` throw `TypeError: Cannot convert argument to a ByteString` and
 * `ServerResponse.setHeader` throw `ERR_INVALID_CHAR` — a description carrying an accented word
 * or an emoji would turn every response on that route into a 500. Restricting to printable ASCII
 * also makes `String.length` an exact byte count, which `header()`'s budget relies on.
 *
 * Written as a printable range on purpose: the control characters this also excludes must never
 * be spelled as literal bytes in this file (narduk-libs#395 — raw `0x00` here made the whole
 * module a binary blob that GitHub would not diff and `grep` would not search).
 */
const UNSAFE_DESCRIPTION = /[^\x20-\x7e]|["\\,]/g

/** A request's database (or any backend) cost, as two independent counts. */
export interface QueryCounts {
  /** Calls into the binding or connection. A batch of eight statements is one round trip. */
  readonly roundTrips: number
  /** Statements executed. A statement prepared once and bound twice counts twice. */
  readonly statements: number
}

/**
 * Renders counts for a `Server-Timing` `desc`. The separator is ` / `, never a comma:
 * `Server-Timing` is itself a comma-separated list, and a comma inside `desc` is safe only for a
 * parser that honours the quoting.
 */
export function formatQueryCounts(counts: QueryCounts): string {
  return `${String(counts.statements)} stmt / ${String(counts.roundTrips)} rt`
}

/**
 * A per-request statement / round-trip counter (narduk-libs#325).
 *
 * Driver-agnostic on purpose: this package knows nothing about D1, Postgres or HTTP. The wrapper
 * around a data binding calls `recordRoundTrip(n)` once per call into the binding, passing the
 * number of statements that call executed -- `1` for `first`/`all`/`run`/`raw` on a D1 prepared
 * statement or one Postgres query, `statements.length` for a D1 `batch`. Two counters, not one:
 * batching moves round trips and leaves statements where they were, and deleting a query does
 * the opposite, so an instrument reporting only one makes half of any optimisation
 * unfalsifiable.
 *
 * Recording never throws. A malformed count (negative, fractional, `NaN`) is floored to a
 * non-negative integer and the round trip still counts: an instrument must not be able to fail
 * the request it is measuring.
 */
export class QueryCounter {
  private roundTripCount = 0
  private statementCount = 0

  /** Records one call into the binding that executed `statements` statements (default 1). */
  recordRoundTrip(statements = 1): void {
    this.roundTripCount += 1
    this.statementCount += Number.isFinite(statements) ? Math.max(0, Math.floor(statements)) : 0
  }

  counts(): QueryCounts {
    return { roundTrips: this.roundTripCount, statements: this.statementCount }
  }

  /** True once anything has been recorded; until then no count is rendered or logged. */
  used(): boolean {
    return this.roundTripCount > 0
  }
}

export interface RequestTimingOptions {
  /**
   * Emit each named phase (and its optional description) in the rendered header. Off by
   * default: a public response then only ever carries `total`, so internal phase names and
   * whatever a caller puts in a description (SQL shape, table names, statement counts) never
   * leave the app unless it opts in for its own routes.
   */
  exposePhases?: boolean
  /** Anchors elapsed time to an existing `performance.now()`/`Date.now()` reading instead of
   *  the moment of construction — used to keep a lazily-created timer's `total` aligned with a
   *  request's actual start. */
  start?: number
  /** Injectable clock for deterministic tests. Defaults to `performance.now`. */
  clock?: () => number
  /**
   * The request's statement / round-trip counter. Omitted, the timer creates its own; either
   * way it is `timing.counter`. Once anything is recorded, each exposed phase without an explicit
   * description renders its own delta (`desc="1 stmt / 1 rt"`) and `total` renders the request's
   * cumulative counts.
   */
  counter?: QueryCounter
}

interface Phase {
  readonly name: string
  readonly durationMs: number
  readonly description?: string
  /** The counter's delta across this phase. */
  readonly counts: QueryCounts
}

function assertName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new TypeError('Timing phase name must match /^[\\w-]{1,64}$/')
  }
}

function sanitizeDescription(description: string): string {
  return description.replaceAll(UNSAFE_DESCRIPTION, '').slice(0, MAX_DESCRIPTION_LENGTH)
}

function entry(name: string, durationMs: number, description?: string): string {
  const dur = `${name};dur=${Math.round(Math.max(0, durationMs))}`
  return description ? `${dur};desc="${description}"` : dur
}

/**
 * A per-request phase timer. `mark(name)` closes the phase running since the previous mark (or
 * since construction) and starts the next one; `measure(name, work)` is the same thing wrapped
 * around an awaited callback. `header()` renders the accumulated phases (only when
 * `exposePhases` is set) plus a trailing `total` as a `Server-Timing` header value.
 *
 * Bounded twice: to 32 marks, and to 2 KB of rendered header. A runaway loop of `mark()` calls
 * stops adding header entries rather than growing the response header without limit. Time already
 * elapsed keeps counting toward `total` either way.
 *
 * Inside a Cloudflare Worker, wall time only advances across I/O — workerd suspends the CPU
 * clock between awaits, which is exactly the boundary each phase is bounded by. A phase that
 * does no I/O reports close to zero regardless of how much synchronous work it did; see the
 * package README's "Timing inside a Worker" note before trusting a CPU-bound phase's duration.
 */
export class RequestTiming {
  /** The request's statement / round-trip counter. See `QueryCounter`. */
  readonly counter: QueryCounter
  private readonly clock: () => number
  private readonly exposePhases: boolean
  private readonly start: number
  private last: number
  private lastCounts: QueryCounts = { roundTrips: 0, statements: 0 }
  private readonly phases: Phase[] = []

  constructor(options: RequestTimingOptions = {}) {
    this.clock = options.clock ?? (() => performance.now())
    this.exposePhases = options.exposePhases ?? false
    this.start = options.start ?? this.clock()
    this.last = this.start
    this.counter = options.counter ?? new QueryCounter()
  }

  mark(name: string, description?: string): void {
    assertName(name)
    const now = this.clock()
    const durationMs = Math.max(0, now - this.last)
    this.last = now
    const counts = this.counter.counts()
    const delta = {
      roundTrips: counts.roundTrips - this.lastCounts.roundTrips,
      statements: counts.statements - this.lastCounts.statements,
    }
    this.lastCounts = counts
    if (this.phases.length >= MAX_PHASES) return
    this.phases.push({
      counts: delta,
      name,
      durationMs,
      ...(description ? { description: sanitizeDescription(description) } : {}),
    })
  }

  /**
   * Runs `work`, then marks `name` with the elapsed time regardless of success or failure.
   *
   * The name is validated up front: `mark()` throwing from the `finally` would replace whatever
   * error `work` raised, so a typo in a phase name would hide the real failure.
   */
  async measure<T>(name: string, work: () => T | Promise<T>): Promise<T> {
    assertName(name)
    try {
      return await work()
    } finally {
      this.mark(name)
    }
  }

  /** Total elapsed milliseconds since construction (or the supplied `start`). */
  totalMs(): number {
    return Math.max(0, this.clock() - this.start)
  }

  /** Renders the current phases (if `exposePhases`) plus `total` as a `Server-Timing` value. */
  header(): string {
    if (!this.exposePhases) return entry('total', this.totalMs())
    // Counts render only once something was counted, so a timer nobody wired a counter into
    // keeps exactly the header it always had.
    const counted = this.counter.used()
    const total = entry(
      'total',
      this.totalMs(),
      counted ? formatQueryCounts(this.counter.counts()) : undefined,
    )
    const rendered: string[] = []
    let remaining = MAX_HEADER_BYTES - total.length
    for (const phase of this.phases) {
      const description =
        phase.description ?? (counted ? formatQueryCounts(phase.counts) : undefined)
      const part = entry(phase.name, phase.durationMs, description)
      const cost = part.length + SEPARATOR.length
      if (cost > remaining) break
      remaining -= cost
      rendered.push(part)
    }
    rendered.push(total)
    return rendered.join(SEPARATOR)
  }
}

/**
 * The counts to put on a request's completion record, or nothing when the request counted
 * nothing -- so a route with no instrumented binding logs exactly the fields it always did.
 */
export function queryCountFields(timing: RequestTiming): Partial<QueryCounts> {
  return timing.counter.used() ? timing.counter.counts() : {}
}
