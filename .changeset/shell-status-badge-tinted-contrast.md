---
'@narduk-enterprises/narduk-shell': patch
---

Fix `NeStatusBadge`'s tinted variants, which could not carry a readable label.

`soft`, `subtle` and `outline` paint `--ui-<color>` text on a 10% tint of that
same colour, and `--ui-<color>` is shade 500. Axe measured it on a live app
(buoys, 2026-09-17) at 2.04:1 for `success`, 1.79:1 for `warning`, 3.30:1 for
`error` and 3.34:1 for `info` — against the 4.5:1 a badge label needs, since
badge text is small. On an elevated surface each is worse again. Every status
this component exists to report was failing WCAG 1.4.3 in every app that used a
tinted variant.

The badge now sets its own text colour to `--ui-color-<color>-800` for those
variants. Shade 800 is the first that clears 4.5:1 on both a white and an
elevated ground (worst case 5.71:1, `warning` on elevated); shade 700 passes on
white and lands at 4.02:1 on elevated, which is the near-miss that reads as
fixed and is not. The shade is read through the colour ALIAS rather than a
literal `text-green-800`, so an app that points `success` at a different ramp
gets its own ramp's shade 800. It is applied to the badge root rather than the
label span, so the leading icon is recoloured with the words — an icon left at
shade 500 on its own tint is about 1.8:1, under the 3:1 floor non-text content
has to clear, and axe has no rule that would have reported it.

Two deliberate omissions, both named in the component and the README so they
read as scope rather than oversight. Dark mode is unchanged: `dark:` restores
`--ui-<color>` exactly, because a dark tint wants a lighter ink rather than a
darker one and nothing has measured it. `solid` is unchanged: it paints white on
the full colour, so a dark ink would be unreadable rather than low-contrast, and
no audited surface uses it.
