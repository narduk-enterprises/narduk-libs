# narduk-logging for Go

Import the module and construct an isolated `slog.Handler`. The constructor
never calls `slog.SetDefault`.

```go
import (
    "log/slog"
    "os"

    narduklogging "github.com/narduk-enterprises/narduk-libs/packages/modules/narduk-logging/go"
)

log, err := narduklogging.NewLogger(os.Stderr, narduklogging.Options{
    Service:     "mybo-edge",
    Environment: "production",
})
if err != nil {
    panic(err)
}
log.Info("edge ready", slog.Int("count", 1))
```

Each line on the writer is one schema record (`schemaVersion`, UTC millis
`timestamp`, mapped `level`, `service`, `environment`, `runtime`, and sanitized
attributes). OTLP export and framework bridges are out of scope for this
adapter.
