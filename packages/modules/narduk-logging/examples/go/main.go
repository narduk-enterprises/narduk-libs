package main

import (
	"log/slog"
	"os"

	narduklogging "github.com/narduk-enterprises/narduk-libs/packages/modules/narduk-logging/go"
)

func main() {
	log, err := narduklogging.NewLogger(os.Stderr, narduklogging.Options{
		Service:     "example-go",
		Environment: "production",
	})
	if err != nil {
		panic(err)
	}
	log.Info("Synthetic logging check", slog.String("check", "go"), slog.Int("count", 1))
}
