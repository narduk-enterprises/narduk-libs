---
'@narduk-enterprises/narduk-logging': patch
'@narduk-enterprises/create-narduk-app': patch
---

Move the optional `@opentelemetry/*` peer and dev ranges from the 0.208 /
2.x-early line to `^0.222.0` / `^2.11.0`.

The experimental `0.2xx` packages pin their stable siblings exactly, so
`^0.208.0` forced `@opentelemetry/core@2.2.0` on every consumer that opts into
the OTLP sink. That version carries GHSA-8988-4f7v-96qf (unbounded memory
allocation in W3C Baggage propagation, medium), first fixed in
`@opentelemetry/core@2.8.0`. `@opentelemetry/sdk-logs@0.219.0` is the first
experimental release pinning `2.8.0`; `0.222.0` is the current matched line and
resolves `@opentelemetry/core@2.11.0`.

The generator is released alongside it because its manifest hard-codes the exact
pins of the packages this release moves.

The peers stay optional, so a consumer that never calls `createOtlpSink` is
unaffected. The sink's API surface — `LoggerProvider({ processors })`,
`OTLPLogExporter`, `SeverityNumber`, `ReadableLogRecord` — is unchanged across
the move.
