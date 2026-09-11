/**
 * `@narduk-enterprises/narduk-shell/format` — reserved subpath, no
 * implementation yet.
 *
 * Backlog item 5, "shared formatters" (narduk-libs#252), owns this module and
 * fills it with the suite's date, number, duration and unit formatters. It is
 * declared and shipped empty from item 1 (narduk-libs#248) so that the export
 * name is reserved before anything consumes it, and so the consumer-fixture
 * subpath tier proves the specifier resolves from an external install on the
 * suite's very first release rather than on the release that finally adds a
 * function to it.
 *
 * Importing this module today is legal and gives you nothing. Do not add a
 * formatter here outside item 5 — a formatter that lands ahead of that item is
 * the per-app formatter duplication the item exists to delete, just relocated.
 */

export {}
