---
'@narduk-enterprises/narduk-ui': minor
---

Treat the `--ns-*` layer as shared defaults an app may override, and make that
true in the CSS rather than only in the prose.

Apps are designed independently (Logan, 2026-09-19), so the token header's old
rules 1 and 2 -- "Ink, surface, signal, type, depth and geometry are SHARED.
Never override per app" and "The only per-app override is the accent triplet" --
were a constraint this package invented downstream of D-WEBFOUND-2 Q3, which
says only that narduk-ui is the coded shared system. The header, README
guardrail 3 and the `_core/signal.ts` doc comment now describe defaults and
where the real obligations sit.

Nineteen alpha composites were written as literal `rgb(14 20 24 / a)` and
`rgb(255 255 255 / a)` -- the default ink and surface spelled out by hand, in
`tokens.css` and in `NsLevelWell`, `NsRangeBar` and `NsReadoutTile`. They made
the new permission untrue: an app overriding `--ns-ink` would have restyled its
text and left the well ticks, dashed median, band and tile hairlines, hatch and
every shadow painted in the old ink. All nineteen now composite through two new
public tokens, `--ns-ink-rgb` and `--ns-surface-rgb`, with no rendered value
changed. `tests/tokens.test.ts` fails if a literal comes back.

Overriding ink or surface therefore means setting the channel triplet beside the
hex, and still clearing the contrast floor stated on the ink block --
`narduk-shell` asks the same of `--ne-*`, and operator-portal#238 is what
happens when nobody does.
