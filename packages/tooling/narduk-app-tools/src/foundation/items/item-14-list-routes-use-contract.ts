/**
 * Item 14 -- list-routes-use-contract (components-library-plan.md §2 item 13,
 * narduk-libs#260; numbered 14 because 9-12 were taken first).
 *
 * A server list route parses its query with narduk-core's `parseListQuery`
 * (plan §2 item 10, narduk-libs#257): limit clamped, sort from an allowlist,
 * unknown keys rejected. The bug class it removes is hand-rolled query parsing
 * (stonx#188-#221, riverstatus's silently stripped keys).
 *
 * WHAT COUNTS AS A LIST ROUTE
 * ---------------------------
 * A source heuristic, stated so a reviewer can argue with it: a file under
 * `server/api/` or `server/routes/` that
 *
 *   1. answers GET -- a `.get.` file, or one with no method suffix;
 *   2. reads its query -- `getQuery(` or `getValidatedQuery(`; and
 *   3. names a pagination key -- `limit`, `offset`, `cursor`, `pageSize` or
 *      `perPage` -- as an object key not given a number literal (`limit:` in
 *      a query schema, but not `{ limit: 1 }`), a property read that is not a
 *      call (`query.limit`, but not the Drizzle builder's `.limit(10)`) or a
 *      string (`'limit'`).
 *
 * Such a route passes when it calls `parseListQuery(`, and a GET route that
 * calls it counts as a list route. A route with no query pagination is not a
 * list route and is not judged.
 */

import { check } from '../schema.js'
import { APP_PREFIXES } from '../reimplementation-signals.js'
import type { AppRepo } from '../source.js'
import { STATUS_FAIL, STATUS_NA, STATUS_PASS, type FoundationSubCheck } from '../types.js'

export const LIST_ROUTES_ITEM_ID = 14
export const LIST_ROUTES_ITEM_NAME = 'list-routes-use-contract'

const ROUTE_DIRS = APP_PREFIXES.flatMap((prefix) => [
  `${prefix}server/api`,
  `${prefix}server/routes`,
])
const ROUTE_EXTENSIONS = ['.ts', '.js', '.mts', '.mjs'] as const

const NON_GET_SUFFIX = /\.(?:post|put|patch|delete|head|options|connect|trace)\.[cm]?[jt]s$/
const READS_QUERY = /\bget(?:Validated)?Query\s*\(/
const PAGINATION_KEY = String.raw`(?:limit|offset|cursor|pageSize|perPage)`
const NAMES_PAGINATION = new RegExp(
  [
    // A key given a number literal (`{ limit: 1 }`) is a fixed value, not a query read.
    String.raw`\b${PAGINATION_KEY}\s*:(?!\s*\d)`,
    String.raw`\.${PAGINATION_KEY}\b(?!\s*\()`,
    String.raw`['"]${PAGINATION_KEY}['"]`,
  ].join('|'),
)
const USES_CONTRACT = /\bparseListQuery\s*\(/

/**
 * The source with its comments removed, so a documented `'limit'` or a
 * commented-out `parseListQuery(` decides nothing. A scanner rather than a
 * lazy block-comment regex, which is polynomial on unterminated `/*` runs. A
 * `//` right after `:` is a URL scheme, not a comment.
 */
function stripComments(source: string): string {
  let code = ''
  let index = 0
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      index = end === -1 ? source.length : end + 2
      code += ' '
    } else if (source.startsWith('//', index) && source[index - 1] !== ':') {
      const end = source.indexOf('\n', index)
      index = end === -1 ? source.length : end
    } else {
      code += source[index]
      index++
    }
  }
  return code
}

/** A GET route that already uses the contract, or reads pagination from its query. */
export function isListRoute(file: string, source: string): boolean {
  if (NON_GET_SUFFIX.test(file)) return false
  const code = stripComments(source)
  return USES_CONTRACT.test(code) || (READS_QUERY.test(code) && NAMES_PAGINATION.test(code))
}

export function evaluateItem14(repo: AppRepo): FoundationSubCheck[] {
  const id = '14.1'
  const name = 'list routes parse their query with parseListQuery'
  const routes = ROUTE_DIRS.flatMap((dir) => repo.walk(dir, ROUTE_EXTENSIONS))

  if (routes.length === 0) {
    return [check(id, name, STATUS_NA, 'no server/api or server/routes handlers')]
  }

  const listRoutes = routes.filter((file) => isListRoute(file, repo.read(file) ?? ''))
  if (listRoutes.length === 0) {
    return [
      check(
        id,
        name,
        STATUS_PASS,
        `no list routes among ${routes.length} handler(s) -- none reads pagination from its query`,
      ),
    ]
  }

  const offenders = listRoutes.filter(
    (file) => !USES_CONTRACT.test(stripComments(repo.read(file) ?? '')),
  )
  if (offenders.length > 0) {
    return [
      check(
        id,
        name,
        STATUS_FAIL,
        `${offenders.length} of ${listRoutes.length} list route(s) parse their own query: ` +
          `${offenders.join(', ')} -- parse it with narduk-core's parseListQuery`,
      ),
    ]
  }
  return [
    check(id, name, STATUS_PASS, `all ${listRoutes.length} list route(s) call parseListQuery`),
  ]
}
