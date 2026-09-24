import {
  createError,
  defineEventHandler,
  getQuery,
  getRequestHeader,
  getRouterParams,
  readRawBody,
} from 'h3'

import { useLogger } from './logger'

import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import type { output as ZodOutput, ZodType } from 'zod'

/** Methods h3 will read a payload for; every other method skips the body read. */
const BODY_METHODS = new Set(['DELETE', 'PATCH', 'POST', 'PUT'])

/** 1 MiB. A JSON API contract that needs more than this wants an upload route. */
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024

const JSON_CONTENT_TYPE = /^application\/(?:[\w.+-]+\+)?json\b/i

/**
 * One rejected field.
 *
 * `path` is rooted at the part of the request it came from — `query.limit`,
 * `params.stationId`, `body.items[0].name` — so a client can group by prefix
 * without a second field. **A submitted value never appears**, in the path or
 * the message.
 *
 * A path does carry object keys and array indices, because an issue is not
 * actionable without them. For a declared field that key is the schema's own;
 * for a `z.record` it is caller data, so a route whose *keys* are secrets
 * (`{ [apiKey]: ... }`) should not use one. The guarantee covers zod's built-in
 * messages: a schema that supplies its own `error` callback interpolating
 * `issue.input` is forwarded verbatim, and owns that choice.
 */
export interface ValidationIssue {
  message: string
  path: string
}

/** `data` on the 400 a failed request validation answers with. */
export interface ValidationErrorData {
  code: 'VALIDATION_FAILED'
  issues: ValidationIssue[]
}

/** What {@link defineValidatedHandler} hands the route body. */
export interface ValidatedHandlerContext<QuerySchema, ParamsSchema, BodySchema> {
  body: ParsedOr<BodySchema, undefined>
  event: H3Event
  params: ParsedOr<ParamsSchema, undefined>
  query: ParsedOr<QuerySchema, undefined>
}

/**
 * What {@link defineValidatedHandler} hands `authorize`.
 *
 * Params and query have already passed; the body has not been read. That is
 * the point of the seam: `requireAuth(event)` used to live inside `handler`,
 * so an unauthenticated caller still paid for the payload and the schema
 * (narduk-libs#371).
 */
export interface ValidatedAuthorizeContext<QuerySchema, ParamsSchema> {
  event: H3Event
  params: ParsedOr<ParamsSchema, undefined>
  query: ParsedOr<QuerySchema, undefined>
}

type ParsedOr<Schema, Fallback> = Schema extends ZodType ? ZodOutput<Schema> : Fallback

type Awaitable<T> = T | Promise<T>

/**
 * A response schema is an **assertion**, so the handler produces the schema's
 * output type and that exact value is what the route returns.
 */
type HandlerResult<ResponseSchema, Result> = ResponseSchema extends ZodType
  ? ZodOutput<ResponseSchema>
  : Result

/** Options accepted by {@link defineValidatedHandler}. */
export interface ValidatedHandlerOptions<
  QuerySchema extends ZodType | undefined,
  ParamsSchema extends ZodType | undefined,
  BodySchema extends ZodType | undefined,
  ResponseSchema extends ZodType | undefined,
  Result,
> {
  /**
   * Runs after params and query pass, before the body is read. Throw an H3
   * error (401/403) to reject. Prefer this over `requireAuth(event)` inside
   * `handler` so an unauthenticated caller never pays for the body read
   * (narduk-libs#371).
   */
  authorize?: (context: ValidatedAuthorizeContext<QuerySchema, ParamsSchema>) => Awaitable<void>
  /** JSON request body. Only read for `POST`, `PUT`, `PATCH` and `DELETE`. */
  body?: BodySchema
  /** The route itself. Receives the parsed values, never the raw request. */
  handler: (
    context: ValidatedHandlerContext<QuerySchema, ParamsSchema, BodySchema>,
  ) => Awaitable<HandlerResult<ResponseSchema, Result>>
  /** Body ceiling in bytes. Defaults to 1 MiB; over it answers 413. */
  maxBodyBytes?: number
  /** Route parameters (`[stationId]`), as h3 hands them over: all strings. */
  params?: ParamsSchema
  /** Query string, as `getQuery` hands it over: strings and string arrays. */
  query?: QuerySchema
  /** Shape this route promises to return. Checked, never used to reshape. */
  response?: ResponseSchema
  /**
   * Whether the response is checked against `response`.
   *
   * `true` always, `false` never, a number in `(0, 1)` samples that fraction of
   * requests. Defaults to **on in development and test, off in production** —
   * see the README for why.
   */
  validateResponse?: boolean | number
}

/**
 * Give a Nitro route a typed request/response contract.
 *
 * The schemas are the route's signature: the handler receives `query`, `params`
 * and `body` already parsed and fully typed, and never touches `getQuery`,
 * `getRouterParam` or `readBody`. A route declares only the parts it has.
 *
 * ## On a bad request
 *
 * **400** with `data` shaped as {@link ValidationErrorData} — a flat list of
 * `{ path, message }`. The body carries field paths and reasons and **never
 * echoes a submitted value**, so a rejected password or token cannot travel
 * back out through the error. Params and query are checked together, so one
 * response lists every bad field; a body is only read once they pass.
 *
 * A body over `maxBodyBytes` answers **413** before it is parsed, and a body
 * sent as anything other than JSON — including one sent with no `content-type`
 * at all — answers **415**.
 *
 * ## On a bad response
 *
 * The response schema is an assertion about what this route promises. When a
 * returned value fails it, that is a server defect: one structured `error`
 * through narduk-logging, then **500**. In development and test the message
 * names the offending paths; in production it says nothing beyond
 * `Internal Server Error`.
 *
 * Checking is **on in development and test, off in production by default**.
 * Every request on Workers pays for it in metered CPU on data the server itself
 * produced, and a response-shape mismatch is a code defect, which is what dev,
 * test and CI are for. Turn it on with `validateResponse: true`, or sample it
 * with `validateResponse: 0.01`.
 *
 * Because it is an assertion, the value the client receives is exactly what the
 * handler returned — whether or not the check ran. A response schema therefore
 * must not `.transform()`, default or coerce: nothing it does would reach the
 * wire. Use `z.strictObject` to have an unpromised field *rejected* rather than
 * silently stripped.
 *
 * ## Authorize before the body
 *
 * `authorize` runs after params and query pass and **before** the body is
 * read. Put `requireAuth` (or any other gate) there, not inside `handler`.
 * A 401 then never pays for the payload or the body schema.
 *
 * A `foundation:check` / lint rule that flags hand-rolled `zod` `safeParse`
 * in app routes is out of scope here: that check belongs in narduk-app-tools
 * or eslint-config, and needs a fleet-wide false-positive pass before it can
 * be required. This wrapper is the library half; Buoys adoption is a
 * separate app change.
 *
 * ## Composing with `defineRateLimitedHandler`
 *
 * Rate limit **outside**, validate inside, so a throttled caller is rejected
 * before the body is read or a schema runs:
 *
 * ```ts
 * export default defineRateLimitedHandler(
 *   defineValidatedHandler({ query: searchQuery, handler: ({ query }) => search(query) }),
 *   { key: 'marine-public-api', limit: 120 },
 * )
 * ```
 *
 * @example
 * ```ts
 * // server/api/stations/[stationId]/history.get.ts
 * export default defineValidatedHandler({
 *   params: z.object({ stationId: z.string().min(1) }),
 *   query: z.object({ limit: z.coerce.number().int().min(1).max(2000).default(500) }),
 *   handler: ({ params, query }) => readHistory(params.stationId, query.limit),
 * })
 * ```
 */
export function defineValidatedHandler<
  QuerySchema extends ZodType | undefined = undefined,
  ParamsSchema extends ZodType | undefined = undefined,
  BodySchema extends ZodType | undefined = undefined,
  ResponseSchema extends ZodType | undefined = undefined,
  Result = unknown,
>(
  options: ValidatedHandlerOptions<QuerySchema, ParamsSchema, BodySchema, ResponseSchema, Result>,
  // The wrapper is always async, so h3's un-awaited return slot holds the
  // `Promise`. Nitro unwraps it when it derives the route's client type. The
  // explicit annotation is load-bearing for the same reason it is in
  // `rateLimitedHandler.ts`: an inferred async return comes out as
  // `Promise<Awaited<T>>`, which TypeScript cannot prove equals `Promise<T>`.
): EventHandler<EventHandlerRequest, Promise<HandlerResult<ResponseSchema, Result>>> {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES

  const run = async (event: H3Event): Promise<HandlerResult<ResponseSchema, Result>> => {
    const issues: ValidationIssue[] = []

    const params = await parseInput(options.params, 'params', () => getRouterParams(event), issues)
    const query = await parseInput(options.query, 'query', () => getQuery(event), issues)
    // Params and query are reported together so one 400 names every bad field.
    // The body is only read once they pass: a request already doomed should not
    // buy a payload read, and on Workers that read is the expensive half.
    if (issues.length > 0) throw badRequest(issues)

    if (options.authorize) {
      await options.authorize({
        event,
        params,
        query,
      } as ValidatedAuthorizeContext<QuerySchema, ParamsSchema>)
    }

    const body = await parseInput(
      options.body,
      'body',
      () => readJsonBody(event, maxBodyBytes),
      issues,
    )
    if (issues.length > 0) throw badRequest(issues)

    const result = await options.handler({
      body,
      event,
      params,
      query,
    } as ValidatedHandlerContext<QuerySchema, ParamsSchema, BodySchema>)

    if (options.response && shouldValidateResponse(options.validateResponse)) {
      assertResponse(event, options.response, result)
    }

    return result
  }

  return defineEventHandler<EventHandlerRequest, Promise<HandlerResult<ResponseSchema, Result>>>(
    run,
  )
}

/**
 * Parse one part of the request, appending any issues rather than throwing, so
 * a caller sees every bad field at once.
 *
 * `read` is a thunk so a part with no schema never pays for its read — which
 * for the body is the difference between touching the payload and not.
 */
async function parseInput(
  schema: ZodType | undefined,
  source: string,
  read: () => Awaitable<unknown>,
  issues: ValidationIssue[],
): Promise<unknown> {
  if (!schema) return undefined

  const parsed = schema.safeParse(await read())
  if (parsed.success) return parsed.data

  collectIssues(source, parsed.error.issues, issues)
  return undefined
}

/** Read a bounded JSON body, or `undefined` when the method carries none. */
async function readJsonBody(event: H3Event, maxBodyBytes: number): Promise<unknown> {
  if (!BODY_METHODS.has((event.method ?? 'GET').toUpperCase())) return undefined

  // A declared length is rejected before a byte is parsed. The runtime — Node
  // or workerd — is what holds the sender to that declaration; this bounds what
  // reaches `JSON.parse` and the schema, which is the cost this wrapper owns.
  const declared = Number(getRequestHeader(event, 'content-length'))
  const lengthDeclared = Number.isFinite(declared)
  if (lengthDeclared && declared > maxBodyBytes) throw payloadTooLarge(maxBodyBytes)

  // A *declared* non-JSON type is refused before the read, so an oversized form
  // or multipart post never reaches memory at all.
  const contentType = getRequestHeader(event, 'content-type')
  if (contentType && !JSON_CONTENT_TYPE.test(contentType)) throw unsupportedMediaType()

  const raw = await readRawBody(event, 'utf8')
  if (raw === undefined || raw === '') return undefined

  // Only measured when the sender declared nothing to hold it to (a chunked
  // upload).
  if (!lengthDeclared && exceedsByteCeiling(raw, maxBodyBytes)) {
    throw payloadTooLarge(maxBodyBytes)
  }

  // An *absent* `content-type` is refused here rather than above, once a body
  // has actually arrived: a request carrying nothing has no media type to
  // object to and deserves the schema's own 400. Refusing it matters because
  // declaring `application/json` is what forces a CORS preflight — a body with
  // no `content-type` is a simple request any cross-origin page can send, so
  // accepting one would hand back the protection the 415 buys.
  if (!contentType) throw unsupportedMediaType()

  try {
    return JSON.parse(raw)
  } catch {
    throw badRequest([{ message: 'Body is not valid JSON', path: 'body' }])
  }
}

/**
 * Whether the decoded body is over the ceiling, without allocating a second
 * full copy of one that already is.
 *
 * `TextEncoder` is the Workers-safe way to count UTF-8 bytes, but it allocates
 * the whole encoding to do it — doubling the peak cost of exactly the request
 * the ceiling exists to refuse. A UTF-16 code-unit count is never greater than
 * the UTF-8 byte count, so a string longer than the ceiling is over it outright
 * and the exact count is only ever taken on one the ceiling already bounds.
 */
function exceedsByteCeiling(raw: string, maxBodyBytes: number): boolean {
  if (raw.length > maxBodyBytes) return true
  return new TextEncoder().encode(raw).byteLength > maxBodyBytes
}

/** Minimal shape of a zod issue — narrower than importing zod's own union. */
interface RawIssue {
  code?: string
  keys?: readonly PropertyKey[]
  message: string
  path: readonly PropertyKey[]
}

/**
 * Flatten zod's issues into the wire shape.
 *
 * Only `error.issues` is walked. A failed `z.union` reports one issue at the
 * union's own path and buries its branch failures in `errors`, which are
 * deliberately left there: they contradict each other (every branch complains
 * about the fields the others declare), and their `unrecognized_keys` prose
 * carries caller key names that the sanitising below would have to be taught to
 * reach. A route that wants per-field detail from a sum type uses
 * `z.discriminatedUnion`, which reports against the discriminator directly.
 * Anything that starts traversing `errors` has to recurse *through here*, or
 * the no-value-leak guarantee above stops being true.
 */
function collectIssues(source: string, raw: readonly RawIssue[], into: ValidationIssue[]): void {
  for (const issue of raw) {
    // zod writes the rejected key names into this message; they are caller
    // text, so they move to the path and the message becomes a constant.
    if (issue.code === 'unrecognized_keys' && issue.keys) {
      for (const key of issue.keys) {
        into.push({ message: 'Unrecognized key', path: formatPath(source, [...issue.path, key]) })
      }
      continue
    }

    into.push({ message: issue.message, path: formatPath(source, issue.path) })
  }
}

function formatPath(source: string, path: readonly PropertyKey[]): string {
  let formatted = source
  for (const segment of path) {
    formatted += typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`
  }
  return formatted
}

function badRequest(issues: ValidationIssue[]) {
  return createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'Request validation failed',
    data: { code: 'VALIDATION_FAILED', issues } satisfies ValidationErrorData,
  })
}

/**
 * The same 400 {@link defineValidatedHandler} answers with, for callers that
 * still parse zod themselves (mutation helpers). `unrecognized_keys` become
 * path segments with a constant message — never key names in `statusMessage`.
 */
export function createValidationFailedError(
  source: string,
  issues: readonly RawIssue[],
): ReturnType<typeof createError> {
  const collected: ValidationIssue[] = []
  collectIssues(source, issues, collected)
  return badRequest(collected)
}

function payloadTooLarge(maxBodyBytes: number) {
  return createError({
    statusCode: 413,
    statusMessage: 'Payload Too Large',
    message: `Request body exceeds the ${maxBodyBytes} byte limit.`,
    // The machine-readable half lives in `data` because that is the field h3
    // serializes on every runtime; `message` is dropped by some error handlers.
    data: { code: 'BODY_TOO_LARGE', maxBodyBytes },
  })
}

function unsupportedMediaType() {
  return createError({
    statusCode: 415,
    statusMessage: 'Unsupported Media Type',
    message: 'Request body must be JSON.',
    data: { code: 'UNSUPPORTED_MEDIA_TYPE' },
  })
}

/**
 * Whether this request checks its response.
 *
 * Exported shape of the decision, in one place, because it is the one piece of
 * this wrapper whose default differs between environments.
 */
function shouldValidateResponse(option: boolean | number | undefined): boolean {
  if (typeof option === 'boolean') return option
  if (typeof option === 'number') {
    if (!(option > 0)) return false
    return option >= 1 || Math.random() < option
  }
  return isDevelopmentRuntime()
}

/**
 * True in `nuxt dev`, under `@nuxt/test-utils`, and in a vitest run.
 *
 * All three flags are build-time constants, never `process.env` — Worker
 * runtime code in this estate may not read it, and a deployed Worker defines
 * none of them, so a production bundle falls through to `false`.
 */
function isDevelopmentRuntime(): boolean {
  const meta = import.meta as unknown as {
    dev?: boolean
    env?: { MODE?: string }
    test?: boolean
  }
  return meta.dev === true || meta.test === true || meta.env?.MODE === 'test'
}

/** Check the returned value against the route's promise; 500 when it breaks. */
function assertResponse(event: H3Event, schema: ZodType, value: unknown): void {
  const parsed = schema.safeParse(value)
  if (parsed.success) return

  const issues: ValidationIssue[] = []
  collectIssues('response', parsed.error.issues, issues)

  logResponseFailure(event, issues)

  // A broken response contract is a server defect. In development and test it is
  // named on the spot; in production it stays an opaque 500, because the detail
  // describes data the caller was never entitled to see.
  const visible = isDevelopmentRuntime()
  const detail = issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw createError({
    statusCode: 500,
    statusMessage: 'Internal Server Error',
    message: visible ? `Response validation failed: ${detail}` : 'Internal Server Error',
    ...(visible ? { data: { code: 'RESPONSE_VALIDATION_FAILED', issues } } : {}),
  })
}

function logResponseFailure(event: H3Event, issues: ValidationIssue[]): void {
  try {
    const matched = event.context.matchedRoute as { path?: unknown } | undefined
    useLogger(event).error('Response validation failed', {
      issues,
      // The matched route template, not `event.path`: the raw path carries
      // caller-chosen identifiers and query values that do not belong in logs.
      route: typeof matched?.path === 'string' ? matched.path : '/[unmatched]',
    })
  } catch {
    // A consumer fixture without a booted Nitro server has no request-local
    // logger to reach. A missing log record must not change the status code.
  }
}
