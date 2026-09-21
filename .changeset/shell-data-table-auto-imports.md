---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
---

Auto-import `parseSort` and `toCsv`, so the data-table utilities are reachable
without naming the package specifier — in a page and in a Nitro server route
(first hit building `packages/design/libs-explorer`, #689).

Nuxt reserves the specifier a module was **registered** under: `@nuxt/kit`
records an `entryPath` per installed module and the import-protection plugin
refuses app code that imports it. That entry path is normally
`@narduk-enterprises/narduk-shell/module`, because `mlly` maps the resolved file
back through this package's `exports` map, which is why
`modules: ['@narduk-enterprises/narduk-shell']` and the README's
`import { parseSort } from '@narduk-enterprises/narduk-shell'` have coexisted
happily since #295 — the packed-consumer smoke proves that shape on every
release.

The mapping needs a `node_modules/` segment in the resolved path. A consumer
whose copy comes from a **checkout** — the workspace link a sibling package in
this repository gets, or an app with a `link:`/`file:` dependency on a clone —
has no such path, so Nuxt falls back to the raw `modules:` string and the bare
specifier becomes the protected one. Every value import of the package root is
then refused, in the Vue app and in Nitro alike:

```
RolldownError: Importing directly from module entry-points is not allowed.
[importing @narduk-enterprises/narduk-shell from app/usage/ne-sort-header.vue]
```

Reproduced on Nuxt 4.5.2 (rolldown) in a minimal consumer, both shapes, page and
server route. An auto-import is immune because the generated import names the
runtime file, never the package.

Two new global names is the cost, and it is the reason the formatters stay out
of the auto-import (a shadowed `formatDate` with a different required signature
is worse than an import). `parseSort` and `toCsv` are this suite's table
vocabulary, they are already the package's documented names, and they now reach
app code the same way `defineStatusMap`, `useCollection` and `useConfirm` do. No
export was added or removed: both remain named exports of the package root for
every consumer whose install is an ordinary one.

The README's `parseSort`/`toCsv` snippets were corrected to match, and a new
"When the bare specifier is refused" section documents the shape and what to
write in it. The packed-consumer smoke's narduk-shell fixture now exercises both
auto-imports in the generated app — in the page beside the existing root value
import, and in a server route, which is also the standing proof that Nitro
transpiles this package's raw TypeScript in a Narduk app.
