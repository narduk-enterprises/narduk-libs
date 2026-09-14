import { getQuery, readBody } from 'h3'

import { apiError } from './errors'

import type { H3Event } from 'h3'
import type { z } from 'zod'

// Reading a request body or query string, in one place, for every route that
// validates one against a Zod schema.
//
// WHY THIS EXISTS
// ----------------
// h3 hands an absent body to a validator as `undefined`, so a plain
// `z.object({...})` refuses even a schema whose every field is optional --
// the ordinary shape of a request that has nothing to say (a POST with
// headers and a query and no body). And both `readValidatedBody` and
// `getValidatedQuery(event, (v) => schema.parse(v))` throw the ZodError
// itself on refusal, so Nitro serializes the issue ARRAY as `message` and a
// client renders `[{"expected":"object","code":"invalid_type",...}]` to a
// person as if somebody had written it.
//
// Two things are fixed here, once, so the next route inherits them rather
// than needing its own `?? {}` and its own try/catch:
//
//   1. AN ABSENT BODY IS AN EMPTY ONE. `undefined` becomes `{}` before the
//      schema sees it, so a schema whose fields are all optional accepts a
//      body-less POST and a schema with a required field still refuses. No
//      schema is loosened to make this true.
//
//   2. A REFUSAL IS A SENTENCE. The Zod issues ride in the error's `data`,
//      where a developer reading a screenshot can find them, and `message` is
//      always copy a person can read.
//
// Extracted from pacc-trac `server/utils/requestBody.ts` (#231, #235);
// narduk-libs#76 Wave 2 "HTTP error + requestBody contract". The client-side
// counterpart -- recognizing a Zod issue dump that reaches a client from
// somewhere this module does not cover -- is
// `@narduk-enterprises/narduk-app/client/api-error`.
//
// USAGE -- a route reads its body or query through one of the functions below
// and no other way; do not call h3's own `readValidatedBody` or
// `getValidatedQuery` directly, and do not call `readBody`/`getQuery` and
// `schema.parse` by hand, or both promises above are lost for that route.
//
//     const body = await readJsonBody(event, schema, refusals)
//     const q = await readQuery(event, schema, refusals)
//
// A route that gives its own fields their own sentences validates the body
// itself and reads it through `readRawJsonBody`, which is the same mechanism
// with the caller's words on the unreadable case.

/**
 * The copy an app shows when a request itself was the problem. Every field is
 * required rather than defaulted: the sentence a person reads after a refused
 * request is product voice, not something this package should invent for an
 * app that never reviewed it (pacc-trac's and harmony's copy differ on
 * purpose).
 */
export interface RequestBodyRefusals {
  /** The request had no body, or one this schema's required fields refuse. */
  incomplete: string
  /** The request body could not be parsed as JSON at all. */
  unreadable: string
  /** The query string does not match the schema. */
  misasked: string
}

/** The machine-readable `data.code` refusals below are tagged with. */
export const REQUEST_BODY_REFUSAL_CODES = Object.freeze({
  invalidBody: 'invalid_body',
  invalidQuery: 'invalid_query',
} as const)

/** The issues, reduced to what is useful in a screenshot: where, and what. */
function issuesOf(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }))
}

/**
 * Read the JSON body of a request and validate it, treating an absent body as
 * an empty one and a refusal as copy.
 *
 * @param event    the request.
 * @param schema   the shape the route accepts. Parsed against `{}` when the
 *                 request carried no body at all, so an all-optional schema
 *                 admits a body-less POST and a required field still refuses.
 * @param refusals the app's own copy for a refused request.
 * @returns the parsed body, typed by the schema.
 * @throws a 400 whose `message` is a sentence and whose `data` carries
 *         `{ code, issues }` for whoever has to debug it.
 */
export async function readJsonBody<S extends z.ZodType>(
  event: H3Event,
  schema: S,
  refusals: RequestBodyRefusals,
): Promise<z.output<S>> {
  const raw = await readRawJsonBody(event, {
    message: refusals.unreadable,
    code: 'unreadable_body',
  })
  const parsed = schema.safeParse(raw)
  if (parsed.success) return parsed.data

  throw apiError(400, refusals.incomplete, {
    code: REQUEST_BODY_REFUSAL_CODES.invalidBody,
    issues: issuesOf(parsed.error),
  })
}

/**
 * Read the query string of a request and validate it, treating a refusal as
 * copy.
 *
 * The counterpart to {@link readJsonBody}, and deliberately the same shape so
 * a route converts by substitution rather than by an edit that has to be
 * reasoned about. `async` for the same reason: it reads at the call site
 * exactly like the `await getValidatedQuery(...)` it replaces.
 *
 * There is no absent-query half here, because there is no absent query: h3's
 * `getQuery` hands back `{}` for a bare URL, which is already the empty
 * object an absent body has to be turned into. As there, the SCHEMA decides
 * -- a required field still refuses a URL that omits it.
 *
 * @param event    the request.
 * @param schema   the shape the route accepts.
 * @param refusals the app's own copy for a refused request.
 * @returns the parsed query, typed by the schema.
 * @throws a 400 whose `message` is a sentence and whose `data` carries
 *         `{ code: 'invalid_query', issues }` for whoever has to debug it.
 */
export async function readQuery<S extends z.ZodType>(
  event: H3Event,
  schema: S,
  refusals: RequestBodyRefusals,
): Promise<z.output<S>> {
  const parsed = schema.safeParse(getQuery(event))
  if (parsed.success) return parsed.data

  throw apiError(400, refusals.misasked, {
    code: REQUEST_BODY_REFUSAL_CODES.invalidQuery,
    issues: issuesOf(parsed.error),
  })
}

/**
 * The same two promises (absent body -> `{}`, refusal -> copy), for a route
 * that validates the body ITSELF and gives its own fields their own
 * sentences.
 *
 * The MECHANISM lives here and the WORDS are the caller's: a route that opts
 * out of {@link readJsonBody}'s shared copy should have to say what its
 * reader sees when the payload cannot even be parsed as JSON, rather than
 * inheriting h3's own machine-facing `Invalid JSON body`.
 *
 * @param event      the request.
 * @param unreadable what to say when the payload is not JSON at all --
 *                   `{ message, code }`, the same shape a route's own field
 *                   refusals are typically kept in.
 * @returns the parsed body, or `{}` when the request carried none. Never
 *          `undefined`: a schema whose fields are all optional accepts a
 *          body-less POST, and a required field still refuses -- the schema
 *          decides, and no schema is loosened to make this true.
 */
export async function readRawJsonBody(
  event: H3Event,
  unreadable: { message: string; code: string },
): Promise<unknown> {
  let raw: unknown
  try {
    // `strict` matches what `readValidatedBody` asks for: a payload that is
    // not JSON is a refusal rather than a silent `undefined`.
    raw = await readBody(event, { strict: true })
  } catch (err) {
    // h3 refuses an unparseable payload with its own 400 whose message is
    // "Invalid JSON body" -- machine-facing text, and the one refusal on this
    // path that was never given words. Anything else it throws (a method it
    // will not read a body for at all) is not ours to reword.
    if ((err as { statusCode?: number } | null)?.statusCode !== 400) throw err
    throw apiError(400, unreadable.message, { code: unreadable.code })
  }

  // `null` as well as `undefined`: a client that sends the four characters
  // `null` has said exactly as much as one that sent nothing.
  return raw === undefined || raw === null ? {} : raw
}
