import { createError } from 'h3'

// One way to refuse a request, so the sentence a person reads survives the
// wire.
//
// WHY THIS EXISTS
// ----------------
// h3 carries two strings on an error and they are not interchangeable:
//
//   statusMessage  the HTTP reason phrase. Machine-facing. h3 runs it through
//                  `sanitizeStatusMessage`, which keeps only tab and printable
//                  ASCII (U+0020-U+007E) and DELETES everything else.
//   message        free text. Untouched. Nitro puts it in the JSON error body
//                  as `message`, which is what a client actually reads.
//
// Product copy written with em-dashes, curly quotes, or any character outside
// that ASCII window silently loses characters if it ends up in
// `statusMessage` -- and HTTP/2 (which Cloudflare serves) carries no reason
// phrase to the browser at all, so `statusText` there is always empty. h3 has
// also announced it will sanitize `statusMessage` by default in a future
// major.
//
// So: the sentence goes in `message`, the reason phrase goes in
// `statusMessage`, and a client reads `message` -- see
// `@narduk-enterprises/narduk-app/client/api-error` for the reader.
//
// Extracted from pacc-trac `server/utils/apiError.ts` (#65); narduk-libs#76
// Wave 2 "HTTP error + requestBody contract".
//
// USAGE
// -----
//     throw apiError(409, `Station ${code} has order #${no} on it.`, { code: 'bay_occupied' })
//
// A machine-facing refusal with nothing for a person to read keeps a bare
// `createError` and its ordinary reason phrase -- `apiError` is only for a
// refusal a person reads.

/**
 * The IANA reason phrase for the status codes an app commonly refuses with.
 * Deliberately dull -- nothing renders these, and any status not listed here
 * falls back to a generic phrase (via {@link reasonPhrase}) rather than
 * inventing one.
 */
export const DEFAULT_REASON_PHRASES: Readonly<Record<number, string>> = Object.freeze({
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  423: 'Locked',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
})

/**
 * The reason phrase for a status code, or a generic one in its class.
 *
 * @param statusCode the HTTP status.
 * @param table      an app's own status -> phrase table, when it refuses with
 *                   a status {@link DEFAULT_REASON_PHRASES} does not cover.
 *                   Defaults to {@link DEFAULT_REASON_PHRASES}.
 */
export function reasonPhrase(
  statusCode: number,
  table: Readonly<Record<number, string>> = DEFAULT_REASON_PHRASES,
): string {
  return table[statusCode] ?? (statusCode >= 500 ? 'Server Error' : 'Request Error')
}

/**
 * Refuse a request with copy a person will read.
 *
 * @param statusCode the HTTP status. Its reason phrase becomes `statusMessage`
 *                    (via {@link reasonPhrase}), never the rendered text.
 * @param message     the sentence the client renders. Any characters --
 *                    nothing sanitizes this field.
 * @param data        machine-readable detail the client branches on, e.g.
 *                    `{ code: 'station_pressure' }`. Nitro serializes it to
 *                    the error body's `data`.
 * @param reasonTable an app's own status -> phrase table, passed through to
 *                    {@link reasonPhrase}.
 */
export function apiError(
  statusCode: number,
  message: string,
  data?: Record<string, unknown>,
  reasonTable?: Readonly<Record<number, string>>,
) {
  return createError({
    statusCode,
    statusMessage: reasonPhrase(statusCode, reasonTable),
    message,
    ...(data === undefined ? {} : { data }),
  })
}
