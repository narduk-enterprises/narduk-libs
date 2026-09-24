package narduklogging

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func emit(t *testing.T, opts Options, emitFn func(*slog.Logger)) map[string]any {
	t.Helper()
	var buf bytes.Buffer
	handler, err := NewHandler(&buf, opts)
	if err != nil {
		t.Fatal(err)
	}
	emitFn(slog.New(handler))
	line := strings.TrimSpace(buf.String())
	if line == "" {
		t.Fatal("handler wrote no record")
	}
	if strings.Count(line, "\n") != 0 {
		t.Fatalf("expected one JSON line, got %q", buf.String())
	}
	var record map[string]any
	if err := json.Unmarshal([]byte(line), &record); err != nil {
		t.Fatalf("record is not JSON: %v\n%s", err, line)
	}
	return record
}

func assertSchemaRecord(t *testing.T, record map[string]any) {
	t.Helper()
	for _, key := range []string{"schemaVersion", "timestamp", "level", "message", "service", "environment", "runtime"} {
		if _, ok := record[key]; !ok {
			t.Fatalf("missing required field %s in %#v", key, record)
		}
	}
	if record["schemaVersion"] != float64(1) {
		t.Fatalf("schemaVersion=%v", record["schemaVersion"])
	}
	timestamp, _ := record["timestamp"].(string)
	if !strings.HasSuffix(timestamp, "Z") || len(timestamp) < len("2026-09-09T00:00:00.000Z") {
		t.Fatalf("timestamp %q is not schema UTC millis", timestamp)
	}
	if parsed, err := time.Parse(timestampLayout, timestamp); err != nil || parsed.Location() != time.UTC {
		t.Fatalf("timestamp %q: %v", timestamp, err)
	}
	level, _ := record["level"].(string)
	switch level {
	case "trace", "debug", "info", "warn", "error", "fatal":
	default:
		t.Fatalf("level %q is outside the schema enum", level)
	}
	allowed := map[string]struct{}{
		"schemaVersion": {}, "timestamp": {}, "level": {}, "message": {},
		"service": {}, "environment": {}, "runtime": {}, "release": {},
		"scope": {}, "requestId": {}, "operationId": {}, "traceId": {},
		"spanId": {}, "method": {}, "path": {}, "source": {}, "data": {},
		"error": {},
	}
	for key := range record {
		if _, ok := allowed[key]; !ok {
			t.Fatalf("additional top-level field %q", key)
		}
	}
}

func TestTextHandlerIsNotSchema(t *testing.T) {
	var buf bytes.Buffer
	slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})).
		Info("edge ready", "count", 1)
	var record map[string]any
	if json.Unmarshal(buf.Bytes(), &record) == nil && record["schemaVersion"] == float64(1) {
		t.Fatalf("stdlib text handler unexpectedly produced a schema record: %s", buf.String())
	}
}

func TestHandlerEmitsSchemaRecord(t *testing.T) {
	record := emit(t, Options{
		Service:     "fixture",
		Environment: "production",
		Clock:       func() time.Time { return time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC) },
	}, func(log *slog.Logger) {
		log.Info("Ready", "count", 1)
	})
	assertSchemaRecord(t, record)
	if record["timestamp"] != "2026-09-09T00:00:00.000Z" {
		t.Fatalf("timestamp=%v", record["timestamp"])
	}
	if record["service"] != "fixture" || record["environment"] != "production" || record["runtime"] != "go" {
		t.Fatalf("identity %#v", record)
	}
	if record["message"] != "Ready" || record["level"] != "info" {
		t.Fatalf("message/level %#v", record)
	}
	data, _ := record["data"].(map[string]any)
	if data["count"] != float64(1) {
		t.Fatalf("data %#v", record["data"])
	}
}

func TestHandlerRedactsSensitiveAttrs(t *testing.T) {
	record := emit(t, Options{Service: "fixture", Environment: "production"}, func(log *slog.Logger) {
		log.Info("Safe",
			"password", "synthetic",
			"tokenCount", 4,
			"url", "https://example:synthetic@example.invalid/items?token=synthetic#private",
		)
	})
	assertSchemaRecord(t, record)
	data, _ := record["data"].(map[string]any)
	if data["password"] != "[REDACTED]" {
		t.Fatalf("password leaked: %#v", data)
	}
	if data["tokenCount"] != float64(4) {
		t.Fatalf("tokenCount=%v", data["tokenCount"])
	}
	if data["url"] != "https://example.invalid/items" {
		t.Fatalf("url=%v", data["url"])
	}
}

func TestHandlerLiftsReservedAttrs(t *testing.T) {
	record := emit(t, Options{Service: "fixture", Environment: "production"}, func(log *slog.Logger) {
		log.Info("Routed",
			"requestId", "req-1",
			"path", "/items?token=synthetic",
			"source", "cli",
			"count", 3,
		)
	})
	assertSchemaRecord(t, record)
	if record["requestId"] != "req-1" {
		t.Fatalf("requestId=%v", record["requestId"])
	}
	if record["path"] != "/items" {
		t.Fatalf("path=%v", record["path"])
	}
	if record["source"] != "cli" {
		t.Fatalf("source=%v", record["source"])
	}
	data, _ := record["data"].(map[string]any)
	if _, ok := data["requestId"]; ok {
		t.Fatalf("requestId remained in data: %#v", data)
	}
	if data["count"] != float64(3) {
		t.Fatalf("data %#v", data)
	}
}

func TestHandlerSanitizesErrorAttr(t *testing.T) {
	record := emit(t, Options{Service: "fixture", Environment: "production"}, func(log *slog.Logger) {
		log.Error("Failed", "error", errors.New("synthetic boom"))
	})
	assertSchemaRecord(t, record)
	errObj, _ := record["error"].(map[string]any)
	if errObj["message"] != "synthetic boom" {
		t.Fatalf("error %#v", errObj)
	}
	if _, ok := errObj["name"].(string); !ok {
		t.Fatalf("error name missing: %#v", errObj)
	}
	if _, ok := record["data"]; ok {
		t.Fatalf("error should not remain in data: %#v", record["data"])
	}
}

func TestHandlerLevelMapping(t *testing.T) {
	cases := []struct {
		level slog.Level
		want  string
	}{
		{slog.LevelDebug - 4, "trace"},
		{slog.LevelDebug, "debug"},
		{slog.LevelInfo, "info"},
		{slog.LevelWarn, "warn"},
		{slog.LevelError, "error"},
		{slog.LevelError + 4, "fatal"},
	}
	min := slog.LevelDebug - 8
	for _, tc := range cases {
		record := emit(t, Options{
			Service:     "fixture",
			Environment: "production",
			Level:       min,
		}, func(log *slog.Logger) {
			log.Log(nil, tc.level, "Mapped")
		})
		if record["level"] != tc.want {
			t.Fatalf("level %v → %v, want %s", tc.level, record["level"], tc.want)
		}
	}
}

func TestHandlerGatesBelowMinimum(t *testing.T) {
	var buf bytes.Buffer
	handler, err := NewHandler(&buf, Options{Service: "fixture", Environment: "production"})
	if err != nil {
		t.Fatal(err)
	}
	slog.New(handler).Debug("Hidden")
	if buf.Len() != 0 {
		t.Fatalf("production default leaked debug: %s", buf.String())
	}
}

func TestHandlerDoesNotSetDefault(t *testing.T) {
	before := slog.Default()
	var buf bytes.Buffer
	log, err := NewLogger(&buf, Options{Service: "fixture", Environment: "production"})
	if err != nil {
		t.Fatal(err)
	}
	log.Info("isolated")
	if slog.Default() != before {
		t.Fatal("NewLogger installed a process-wide default")
	}
}

func TestHandlerRejectsBlankService(t *testing.T) {
	if _, err := NewHandler(nil, Options{Service: " ", Environment: "production"}); err == nil {
		t.Fatal("expected identity error")
	}
}

func TestHandlerWithGroupNestsData(t *testing.T) {
	record := emit(t, Options{Service: "fixture", Environment: "production"}, func(log *slog.Logger) {
		log.WithGroup("edge").Info("Bound", "count", 2)
	})
	data, _ := record["data"].(map[string]any)
	nested, _ := data["edge"].(map[string]any)
	if nested["count"] != float64(2) {
		t.Fatalf("grouped data %#v", data)
	}
}
