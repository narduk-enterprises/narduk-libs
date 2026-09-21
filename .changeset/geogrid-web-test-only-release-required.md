---
'@narduk-enterprises/geogrid-web': patch
---

Turn an open "revisit this" `eslint-disable` comment in `tests/temporal.test.ts`
into a permanent, documented decision not to redesign the parameterized mutator
test's typing — the alternative is per-mutation type duplication for no runtime
benefit (narduk-libs#144).

Test-only change; the package's published `dist/` output is unaffected.
