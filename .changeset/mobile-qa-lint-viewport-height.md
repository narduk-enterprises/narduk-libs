---
'@narduk-enterprises/eslint-config': minor
---

`design-system` pack: `better-tailwindcss/no-restricted-classes` now bans `h-screen`, `min-h-screen`, `max-h-screen` (with any variant) and arbitrary values containing `<n>vh`, pointing at `dvh`/`svh` (mobile web QA rule 4: `100vh` is the large viewport, so a phone's browser chrome hides the bottom of the page). `h-screen` and `min-h-screen` autofix to `h-dvh` and `min-h-dvh`; run `eslint --fix` on upgrade.
