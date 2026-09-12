# Changelog

## 0.1.0

- Initial release: the `TelemetryHistoryStore` boundary and its TimescaleDB +
  PostGIS adapter.
- Drizzle-free SQL builders with stated, tested parameter ceilings; a batched
  write path; rollup and track reads with row bounds and truncation reporting.
- The docs/04 history schema as three versioned migrations: hypertables with
  compression, the 1m → 15m → 1h → 1d continuous-aggregate ladder, and the three
  least-privilege roles.
- Retention parameterized by tier windows supplied by the consumer, guarded by
  in-process single-flight and a Postgres advisory lock.
- A narrow read-only Influx adapter for dual-run parity, holding no credential.
