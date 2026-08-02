// @ts-check
/**
 * The single `no-restricted-imports` setting every pack shares.
 *
 * ## Why this module exists
 *
 * Flat config merges *configs*, not rule options: for a given file the last
 * matching entry's `no-restricted-imports` is the **only** one that applies.
 * Three packs set that rule on overlapping globs — `cloudflare` (Node built-ins
 * have no Workers implementation), `server` (reach for `#server/*`, not `../`),
 * and `template` (reach for a layer's `#layer` alias, not its sources) — so the
 * setting's contents were decided by whichever pack the consumer happened to
 * list last.
 *
 * v2's first cut handled that by having each pack *restate* the bans of the
 * packs it expected to sort before it. That works for exactly the orders it was
 * written against. The adversarial pass composed `core, server, auth, template,
 * cloudflare` — a legal order a consumer can write today — and the Cloudflare
 * pack's paths-only entry sorted last and silently deleted the relative-import
 * and layer-source `patterns` for every Nitro handler in the app. A security
 * setting whose contents depend on the order of a consumer's array is not a
 * setting; it is a coin flip.
 *
 * So there is one option object, defined once, and all three packs assign it
 * verbatim. Whichever entry sorts last, the merged result is identical —
 * `tests/composition/no-restricted-imports.test.ts` asserts exactly that across
 * both orders.
 *
 * ## Consequence, stated plainly
 *
 * The bans are no longer scoped to the pack that motivated them: selecting
 * `cloudflare` alone now also bans relative parent imports and layer-source
 * reach-in inside its globs. That is the price of order-independence, and it is
 * the right side of the trade — the alternative is a config that enforces a
 * different policy depending on how a consumer spelled its pack list.
 *
 * A package that legitimately needs one of these patterns — a portable Nuxt
 * layer importing its *own* internals relatively, which has no `#server/*`
 * alias to import through — opts out in its own config by restating the option
 * without that pattern group. Import the constants from here (re-exported by
 * `configs/server.mjs`, `configs/cloudflare.mjs` and `configs/template.mjs`) so
 * the opt-out drops one group instead of silently unbanning `node:fs`.
 */

/**
 * Test and fixture **directories**, as globs — the glob-level twin of
 * `inTestOrFixtureDirectory()` in `src/rules/utils/path-scope.ts`, and the same
 * segment list.
 *
 * Every bespoke rule in the server tier derives its own test exemption from the
 * filename, so a pack glob that matches test code costs nothing. The two *core*
 * ESLint rules the packs carry — `no-restricted-imports` and `no-await-in-loop`
 * — have no such gate, and once the server globs became nesting-safe they
 * started matching `tests/server/**`: a suite importing the module under test
 * relatively became a lint error, and a deliberately sequential loop in a
 * fixture became one too. Those entries take these ignores so the glob supplies
 * the gate the rule does not have.
 *
 * Directories only, deliberately. A `.test.` infix in a *basename* is not an
 * exemption anywhere in this package any more — see `isExemptTestPath()` and
 * the `server/api/deploy.test.post.ts` case it exists for.
 */
export const TEST_TREE_IGNORES = [
  '**/__fixtures__/**',
  '**/__mocks__/**',
  '**/__snapshots__/**',
  '**/__test__/**',
  '**/__tests__/**',
  '**/e2e/**',
  '**/fixtures/**',
  '**/spec/**',
  '**/specs/**',
  '**/test/**',
  '**/tests/**',
]

/** Node built-ins with no Workers implementation, in both spellings. */
export const NODE_BUILTIN_IMPORT_RESTRICTIONS = [
  ['fs', 'fs is not available in Cloudflare Workers.'],
  ['fs/promises', 'fs/promises is not available in Cloudflare Workers.'],
  ['net', 'net is not available in Cloudflare Workers.'],
  ['tls', 'tls is not available in Cloudflare Workers.'],
  ['child_process', 'child_process is not available in Cloudflare Workers.'],
  ['cluster', 'cluster is not available in Cloudflare Workers.'],
  ['worker_threads', 'worker_threads is not available in Cloudflare Workers.'],
].flatMap(([name, message]) => [
  { name, message },
  { name: `node:${name}`, message },
])

/** Replaces narduk/no-relative-server-imports. */
export const SERVER_RELATIVE_IMPORT_PATTERNS = [
  {
    group: ['../*', '../**'],
    message: 'Import server code through the #server/* alias instead of a relative parent path.',
  },
]

/** Replaces narduk/no-direct-layer-source-imports. */
export const LAYER_SOURCE_IMPORT_PATTERNS = [
  {
    group: ['**/layers/*/server/**', '**/layers/*/app/**'],
    message:
      'Import layer code through its #layer alias (#layer/... for core, #layer-<name>/... otherwise) instead of reaching into layer sources.',
  },
]

/**
 * The merged option. Every pack assigns this exact object, so composition order
 * cannot change what a file is linted against.
 */
export const RESTRICTED_IMPORTS_OPTION = {
  paths: NODE_BUILTIN_IMPORT_RESTRICTIONS,
  patterns: [...SERVER_RELATIVE_IMPORT_PATTERNS, ...LAYER_SOURCE_IMPORT_PATTERNS],
}

/** The rule setting itself, ready to spread into a `rules` block. */
export const RESTRICTED_IMPORTS_RULE = /** @type {const} */ (['error', RESTRICTED_IMPORTS_OPTION])

/**
 * The same option **minus the relative-parent ban**, for a portable Nuxt layer.
 *
 * `SERVER_RELATIVE_IMPORT_PATTERNS` says "import server code through the
 * `#server/*` alias instead of `../`". That alias is created by a Nuxt *app*.
 * A layer published as a package — `narduk-core`, `-auth`, `-seo`, `-ai`,
 * `-uploads` — has no such alias for its own sources, so its handlers reach
 * their own `server/utils` and `shared/` modules relatively and there is no
 * other spelling available to them. The ban is correct policy for an app and
 * unsatisfiable inside a layer.
 *
 * This constant exists because five packages need the identical exception, and
 * the estate standard is that lint policy lives in the shared package rather
 * than being restated per project (Reusable Libraries And Packages: keep an
 * adapter shape here once three or more consumers converge on it). Five
 * hand-rolled copies would drift, and — as `narduk-ai`'s first copy did —
 * quietly lose the bans they were not thinking about at the time.
 *
 * **It drops exactly one pattern group.** The Node-built-in `paths` ban and the
 * layer-source ban both survive: a layer must still not import `node:fs`, and
 * must still not reach into *another* layer's sources. A package opting out of
 * more than this is not using this constant.
 */
export const PORTABLE_LAYER_RESTRICTED_IMPORTS_OPTION = {
  paths: NODE_BUILTIN_IMPORT_RESTRICTIONS,
  patterns: [...LAYER_SOURCE_IMPORT_PATTERNS],
}

/** Ready to assign in a portable layer's own `eslint.config.mjs`. */
export const PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE = /** @type {const} */ ([
  'error',
  PORTABLE_LAYER_RESTRICTED_IMPORTS_OPTION,
])
