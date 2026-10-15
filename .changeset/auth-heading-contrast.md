---
'@narduk-enterprises/narduk-auth': patch
---

Auth card headings (sign in, register, reset password, exchange, native and OAuth
authorize) now carry `text-highlighted`. They had no colour class, so an app whose
body text is light on a dark brand surface rendered them near-invisible on the
white light-mode card.
