---
'@narduk-enterprises/narduk-ui': patch
---

Correct the token layer's per-app override rule. `tokens.css` declared "Ink,
surface, signal, type, depth and geometry are SHARED. Never override per app"
and "The only per-app override is the accent triplet", and the README and
`_core/signal.ts` repeated it. Apps are designed independently, so the tokens
are shared defaults an app may override for its own design, and the accent
triplet is the smallest useful override rather than the only permitted one.

No token values change. The rule this corrects was package prose, not the
decision it cited: company-hq D-WEBFOUND-2 Q3 establishes narduk-ui as the coded
system that syncs one way into NE Base, and says nothing about accent triplets
or per-app overrides.

"Accent is never status" is kept and its reasoning made explicit, because it
holds even for an app that restyles the signal tokens.
