# narduk-logging for Python

Install the wheel from the private Narduk Libs release, then import
`narduk_logging`. Development uses `uv sync --all-extras`; see the package's
shared adoption guide for authenticated wheel installation and collector setup.

```python
from narduk_logging import create_logger

log = create_logger(service="feed-loader", environment="production")
log.info("Feed refreshed", {"count": 42})
log.close()
```

Logs default to structured JSON on stderr. They never configure the root logger
on import. Use `install_stdlib_handler` explicitly to adopt existing `logging`
calls, or `create_dagster_logger` from `narduk_logging.dagster` for Dagster.
