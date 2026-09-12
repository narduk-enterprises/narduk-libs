---
'@narduk-enterprises/narduk-shell': minor
---

Fill the reserved `./format` subpath with the suite's shared formatters
(components-library backlog item 5, narduk-libs#252): `formatDate`,
`formatDateTime`, `formatRelative`, `formatDuration`, `formatNumber`,
`formatCompact`, `formatPercent`, `formatMoney`, `formatQuantity` and
`createFormatters`.

`Intl` and nothing else — no Vue, no Nuxt, no dependency — so the same function
is callable from a component, a Nitro route, a plain Node script and
`nuxt.config.ts`.

**Nothing here reads the ambient clock or the host time zone.** `timeZone` is
required by the types on every date formatter and `formatRelative` requires
`now`; neither is defaulted, because the default is the bug. A Nuxt page renders
once on a server (UTC, in a Worker) and again in the reader's browser (their
zone, their locale), so a formatter that consults either produces two strings
for one value and Vue's hydration check turns that into a flicker or a dropped
server render — operator-portal#262 and #268, stonx#674 and #675, and
riverstatus's hand-rolled DST table. `test/format.ssr.test.ts` proves the
property in a child process under four `TZ` and three `LC_ALL` settings,
requiring byte-identical output, and carries a canary showing the host
environment does move an unpinned `Intl` formatter.

Two behaviours differ from the prior art they replace, on purpose.
`formatPercent` reads its argument as a **fraction** by default (`0.055` is
5.5%), which is `Intl`'s convention and the opposite of stonx's `fromDecimal`
default, so the reading is spelled out at the call site (`input: 'percent'`)
rather than silently inherited and wrong by 100x. `formatCompact` uses `Intl`
compact notation with one fraction digit (`1.2K`) rather than stonx's
English-only `K`/`M`/`B`/`T` ladder with two; `{ digits: 2 }` restores the old
shape.

`formatDuration` never climbs above a day, since a month is not a fixed span,
and keeps the sign of a negative span instead of laundering clock skew into
`'unknown'`. `formatQuantity` appends an unsanctioned unit after a space
(riverstatus's `cfs`) instead of letting `Intl` throw a `RangeError`.
`Intl.*Format` instances are memoised per kind, keyed by locale plus the full
sorted option set, capped at 256 entries.

The formatters are deliberately **not** auto-imported by the Nuxt module: every
pilot app already has its own `formatDate` in `app/utils/`, and shadowing it
with a different required signature is not an upgrade anyone asked for.

Also adds `src/surface-cards.ts`, the second and much smaller list that may
authorise an NE Base design card, so that `Formatters.card.vue` can preview an
export subpath rather than a component without weakening the card/registry
pairing rule in either direction.
