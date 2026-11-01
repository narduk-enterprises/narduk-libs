---
'@narduk-enterprises/create-narduk-app': patch
---

The generated `AGENTS.md` router region now tells agents to search what libs ships with `libs-find` before writing a composable, util, server helper or component, and to mark a copy kept on purpose with `// LIBS-KEEP: <export> <reason>`. Existing apps pick the line up on their next `create-narduk-app upgrade` (narduk-libs#2127).
