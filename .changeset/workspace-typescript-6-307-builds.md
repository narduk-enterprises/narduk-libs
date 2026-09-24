---
'@narduk-enterprises/geogrid-web': patch
'@narduk-enterprises/narduk-postgres': patch
---

Build with TypeScript 6.0 (narduk-libs#307). geogrid-web's build config names its `rootDir` explicitly, as TypeScript 6 requires; the emitted files are unchanged. narduk-postgres's redaction patterns drop two capture groups nothing read, so the output is unchanged.
