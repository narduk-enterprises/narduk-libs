# Search and troubleshoot

The fleet logging deployment owns Grafana access, ingestion credentials and
storage. Use its
[operator runbook](https://github.com/narduk-enterprises/fleet/tree/main/infrastructure/logging).
Operator credentials and producer credentials are separate; client applications
never receive either. Searchable history is limited to the last 14 days.

In Grafana Explore, select **Narduk Logs**, then filter by service and
environment:

```logql
{service_name="feed-loader", deployment_environment_name="production"}
```

Errors across an environment:

```logql
{deployment_environment_name="production", narduk_level=~"error|fatal"}
```

Copy a response's `x-request-id` into a correlation filter. Request and
operation identifiers are structured metadata rather than index labels:

```logql
{service_name="feed-loader"} | requestId="synthetic-request-123"
```

Job failures and their safe structured context:

```logql
{service_name="feed-loader"} | json | data_outcome="failure"
```

For missing records, check in this order:

1. Confirm an in-memory sink receives the synthetic event at the configured
   level.
2. Confirm the process emits one canonical JSON record. A fixed message plus a
   safe `check` field makes this easy to distinguish from unrelated output.
3. Check producer authentication and the exact `/v1/logs` endpoint. A 401 means
   credentials were rejected; 429 means ingestion limits were reached.
4. Check buffer `dropped` and `deliveryFailures` diagnostics, shutdown flushing
   and collector health. Libraries do not recursively log delivery failures.
5. Check the environment, time window, runtime and service labels in Grafana.
6. For Workers, verify the native destination's delivery status and account
   eligibility. For client diagnostics, inspect the app-owned endpoint's
   authentication, allowed origin, rate limiter, body limits and field
   allowlist.

Native Workers export requires Workers Paid and is currently beta. Enable full
log sampling initially, verify an actual delivered event, and preserve the app's
existing `persist` setting. Creating a destination does not prove delivery. See
[Cloudflare's export documentation](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/).

Loki's query window and physical object deletion are distinct checks. Compactor
retention deletes expired chunks asynchronously; a query returning no old
entries does not prove the objects are gone. Fleet acceptance records both
checks, along with restart and collector-outage tests. See
[Loki retention](https://grafana.com/docs/loki/latest/operations/storage/retention/).

Logs are diagnostics, not a durable audit ledger. Bounded buffers drop during
long outages. Arbitrary secrets embedded in message text cannot be reliably
detected; use fixed messages and sanitized structured fields.
