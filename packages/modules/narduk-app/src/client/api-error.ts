// Reading a refusal, in one file.
//
// The server side of this is `@narduk-enterprises/narduk-app/server/errors`
// and `.../server/request-body` -- read those first; they explain why the
// sentence lives in `message` and not in `statusMessage`, and why a Zod
// refusal's `message` can be an issue-array dump rather than copy.
//
// WHAT A CAUGHT `$fetch` ERROR ACTUALLY LOOKS LIKE
// -------------------------------------------------
// ofetch throws a `FetchError` whose `data` is the PARSED RESPONSE BODY, and
// Nitro's error body is:
//
//     { error, url, statusCode, statusMessage, message, data }
//                                └ reason phrase  └ copy   └ { code, ... }
//
// so the sentence is at `err.data.message` and the machine-readable detail a
// caller branches on is at `err.data.data`. Everything else is a trap:
//
//  - `err.statusMessage` is NOT the body's field. ofetch defines it as
//    `response.statusText` -- the HTTP reason phrase, which h3 sanitizes and
//    which HTTP/2 (Cloudflare) does not carry to the browser at all. A site
//    reading it renders an empty string in production: `'' ?? fallback` is
//    `''`, not the fallback.
//  - `err.message` is ofetch's own "[POST] /api/x: 409 Conflict", never copy.
//
// So this reads the body, and only the body. A network failure has no body,
// gets no `message`, and falls through to the caller's own words rather than
// putting a raw fetch failure in front of a person.
//
// Extracted from pacc-trac `app/utils/apiError.ts` and harmony-hot-sauce
// `app/utils/apiError.ts`'s `describeApiError`; narduk-libs#76 Wave 2 "HTTP
// error + requestBody contract".

/** The JSON body Nitro sends for a refused request. */
export interface ApiErrorBody {
  statusCode?: number
  /** The user-facing sentence. `apiError()` (server-side) puts it here. */
  message?: string
  /** The reason phrase. Read only as a fallback for a bare `createError`. */
  statusMessage?: string
  /** Machine-readable detail: `{ code: 'station_pressure', ... }`. */
  data?: Record<string, unknown>
}

/** The body of a caught `$fetch` rejection, or undefined if it carried none. */
export function apiErrorBody(err: unknown): ApiErrorBody | undefined {
  const body = (err as { data?: unknown } | null | undefined)?.data
  return body && typeof body === 'object' ? (body as ApiErrorBody) : undefined
}

/**
 * True when the body's `message` is a raw Zod issue dump, not a sentence.
 *
 * h3's own `readValidatedBody` (and `getValidatedQuery` used the same way)
 * refuse with the ZodError itself: `message` becomes the JSON-printed array
 * of issues and `data` the serialized error, `{ name: 'ZodError', ... }`.
 * Nobody wrote that for a reader, so it reads as "no usable sentence" here,
 * never as copy.
 *
 * `@narduk-enterprises/narduk-app/server/request-body`'s `readJsonBody` and
 * `readQuery` stop producing these; this is the second belt, for a route (in
 * this app or a caller this package does not know about) that reads a body
 * or query some other way.
 */
export function isZodIssueDump(body: ApiErrorBody | undefined): boolean {
  if (!body) return false
  if (body.data?.name === 'ZodError') return true
  const msg = body.message?.trimStart()
  if (!msg?.startsWith('[')) return false
  try {
    return Array.isArray(JSON.parse(msg))
  } catch {
    return false
  }
}

/**
 * The sentence to show for a caught `$fetch` rejection.
 *
 * `message` first: that is where the server's `apiError()` puts the copy.
 * `statusMessage` second, because a bare `createError({ statusCode,
 * statusMessage })` still mirrors its reason phrase into `message` -- but a
 * hand-written error that set only `statusMessage` would otherwise read as
 * nothing. Then the caller's fallback, which is what a network failure gets.
 *
 * A validation refusal is the exception: its `message` is a machine's Zod
 * dump ({@link isZodIssueDump}), so the caller's fallback speaks instead. A
 * server's own sentences still render verbatim.
 *
 * `||` and not `??` on purpose: an empty string is not an error message.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const body = apiErrorBody(err)
  if (isZodIssueDump(body)) return fallback
  return body?.message || body?.statusMessage || fallback
}

/** The `data.code` a refusal was tagged with, e.g. `'station_pressure'`. */
export function apiErrorCode(err: unknown): string | undefined {
  const code = apiErrorBody(err)?.data?.code
  return typeof code === 'string' ? code : undefined
}

/** The HTTP status of a caught `$fetch` rejection. */
export function apiErrorStatus(err: unknown): number | undefined {
  const status = (err as { statusCode?: number } | null | undefined)?.statusCode
  return typeof status === 'number' ? status : apiErrorBody(err)?.statusCode
}

/** {@link describeApiError}'s result. */
export interface ApiErrorDescription {
  message: string | null
  statusCode: number | null
}

/**
 * A thinner reading of the same body: the status and message as nullable
 * fields rather than a required fallback, for a caller (an admin form
 * surfacing a save failure, say) that wants to fall back on its own logic
 * rather than take this package's fallback string. Mirrors
 * harmony-hot-sauce's `describeApiError`.
 *
 * Unlike {@link apiErrorMessage}, this does not filter a Zod issue-array
 * dump -- a caller that wants that belt should read `isZodIssueDump` itself,
 * or prefer `apiErrorMessage`.
 *
 * @param stripPrefix a literal prefix to remove from the message before
 *                     returning it (harmony strips h3's own
 *                     `"Validation error: "` prefix on some refusals).
 */
export function describeApiError(err: unknown, stripPrefix?: string): ApiErrorDescription {
  const body = apiErrorBody(err)
  const status = apiErrorStatus(err)
  // `message` first, matching `apiErrorMessage`'s contract above: it is where
  // the server's `apiError()` puts a sentence a person wrote, and
  // `statusMessage` is the machine-facing reason phrase, read only as a
  // fallback for a bare `createError` that never set `message` at all.
  const raw = body?.message || body?.statusMessage || undefined
  const message =
    stripPrefix && raw?.startsWith(stripPrefix) ? raw.slice(stripPrefix.length) : (raw ?? null)
  return { message, statusCode: status ?? null }
}
