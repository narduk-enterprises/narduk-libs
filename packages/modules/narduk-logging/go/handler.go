package narduklogging

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

var (
	traceIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
	spanIDPattern  = regexp.MustCompile(`^[a-f0-9]{16}$`)
	controlRunes   = regexp.MustCompile(`[\x00-\x1f\x7f]`)
)

const (
	maxService     = 128
	maxEnvironment = 64
	maxRuntime     = 64
	maxRelease     = 128
	maxScope       = 256
	maxRequestID   = 128
	maxOperationID = 128
	maxMethod      = 32
	maxPath        = 512
)

// Options configure an isolated slog handler. NewHandler never calls
// slog.SetDefault.
type Options struct {
	Service      string
	Environment  string
	Runtime      string
	Release      string
	Scope        string
	Level        slog.Leveler
	Writer       io.Writer
	Clock        func() time.Time
	Redact       []string
	IncludeStack bool
}

// Handler writes one schema-conformant JSON record per line.
type Handler struct {
	w      io.Writer
	opts   Options
	mu     *sync.Mutex
	attrs  map[string]any
	groups []string
}

// NewHandler returns an slog.Handler that emits narduk-logging records.
// The caller owns w; the handler never closes it. A nil writer uses
// Options.Writer, then os.Stderr.
func NewHandler(w io.Writer, opts Options) (*Handler, error) {
	service, err := identity(opts.Service, "service", maxService)
	if err != nil {
		return nil, err
	}
	environment, err := identity(opts.Environment, "environment", maxEnvironment)
	if err != nil {
		return nil, err
	}
	runtime := opts.Runtime
	if runtime == "" {
		runtime = "go"
	}
	runtime, err = identity(runtime, "runtime", maxRuntime)
	if err != nil {
		return nil, err
	}
	var release string
	if opts.Release != "" {
		release, err = identity(opts.Release, "release", maxRelease)
		if err != nil {
			return nil, err
		}
	}
	var scope string
	if opts.Scope != "" {
		scope = cleanText(opts.Scope, maxScope)
	}
	if w == nil {
		w = opts.Writer
	}
	if w == nil {
		w = os.Stderr
	}
	opts.Service = service
	opts.Environment = environment
	opts.Runtime = runtime
	opts.Release = release
	opts.Scope = scope
	return &Handler{
		w:     w,
		opts:  opts,
		mu:    &sync.Mutex{},
		attrs: map[string]any{},
	}, nil
}

// NewLogger wraps NewHandler in an isolated slog.Logger. It does not install
// the logger as the process default.
func NewLogger(w io.Writer, opts Options) (*slog.Logger, error) {
	handler, err := NewHandler(w, opts)
	if err != nil {
		return nil, err
	}
	return slog.New(handler), nil
}

func identity(value, name string, limit int) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || len(value) > limit || controlRunes.MatchString(value) {
		return "", fmt.Errorf("logging %s must contain 1..%d characters without controls", name, limit)
	}
	return trimmed, nil
}

func (h *Handler) minLevel() slog.Level {
	if h.opts.Level != nil {
		return h.opts.Level.Level()
	}
	if h.opts.Environment == "development" {
		return slog.LevelDebug
	}
	return slog.LevelInfo
}

// Enabled reports whether a record at level would be written.
func (h *Handler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.minLevel()
}

// Handle writes one JSON record. Failures are returned and never re-enter logging.
func (h *Handler) Handle(_ context.Context, r slog.Record) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("narduklogging: %v", recovered)
		}
	}()
	if !h.Enabled(context.Background(), r.Level) {
		return nil
	}
	record := h.buildRecord(r)
	payload, encodeErr := encodeRecord(record)
	if encodeErr != nil {
		return encodeErr
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	_, err = h.w.Write(append(payload, '\n'))
	return err
}

// WithAttrs returns a handler that includes attrs on every record.
func (h *Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	clone := *h
	clone.attrs = mergeMaps(cloneMap(h.attrs), nestGroups(attrsToMap(attrs), h.groups))
	return &clone
}

// WithGroup nests subsequent attributes under name.
func (h *Handler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	clone := *h
	clone.groups = append(append([]string{}, h.groups...), name)
	return &clone
}

func (h *Handler) buildRecord(r slog.Record) map[string]any {
	fields := mergeMaps(cloneMap(h.attrs), nestGroups(recordAttrs(r), h.groups))
	safe := sanitizeFields(fields, h.opts.Redact, h.opts.IncludeStack)
	record := map[string]any{
		"schemaVersion": 1,
		"timestamp":     h.timestamp(r),
		"level":         mapLevel(r.Level),
		"message":       cleanText(r.Message, maxString),
		"service":       h.opts.Service,
		"environment":   h.opts.Environment,
		"runtime":       h.opts.Runtime,
	}
	if h.opts.Release != "" {
		record["release"] = h.opts.Release
	}
	if h.opts.Scope != "" {
		record["scope"] = h.opts.Scope
	}
	liftReserved(record, safe, h.opts)
	if errValue, ok := safe["error"]; ok {
		delete(safe, "error")
		record["error"] = errorFields(errValue, h.opts.IncludeStack, 0)
	}
	if len(safe) > 0 {
		record["data"] = safe
	}
	return boundRecord(record)
}

func (h *Handler) timestamp(r slog.Record) string {
	var now time.Time
	if h.opts.Clock != nil {
		now = h.opts.Clock()
	} else if !r.Time.IsZero() {
		now = r.Time
	} else {
		now = time.Now()
	}
	return now.UTC().Format(timestampLayout)
}

func mapLevel(level slog.Level) string {
	switch {
	case level < slog.LevelDebug:
		return "trace"
	case level < slog.LevelInfo:
		return "debug"
	case level < slog.LevelWarn:
		return "info"
	case level < slog.LevelError:
		return "warn"
	case level < slog.LevelError+4:
		return "error"
	default:
		return "fatal"
	}
}

func recordAttrs(r slog.Record) map[string]any {
	attrs := make([]slog.Attr, 0, r.NumAttrs())
	r.Attrs(func(attr slog.Attr) bool {
		attrs = append(attrs, attr)
		return true
	})
	return attrsToMap(attrs)
}

func attrsToMap(attrs []slog.Attr) map[string]any {
	out := map[string]any{}
	for _, attr := range attrs {
		attr.Value = attr.Value.Resolve()
		if attr.Equal(slog.Attr{}) {
			continue
		}
		if attr.Value.Kind() == slog.KindGroup {
			nested := attrsToMap(attr.Value.Group())
			if attr.Key == "" {
				for key, value := range nested {
					out[key] = value
				}
				continue
			}
			out[attr.Key] = nested
			continue
		}
		if attr.Key == "" {
			continue
		}
		out[attr.Key] = attrToValue(attr.Value)
	}
	return out
}

func attrToValue(value slog.Value) any {
	switch value.Kind() {
	case slog.KindString:
		return value.String()
	case slog.KindInt64:
		return jsSafeInt(value.Int64())
	case slog.KindUint64:
		return jsSafeUint(value.Uint64())
	case slog.KindFloat64:
		return jsSafeFloat(value.Float64())
	case slog.KindBool:
		return value.Bool()
	case slog.KindDuration:
		return value.Duration().Milliseconds()
	case slog.KindTime:
		t := value.Time()
		if t.IsZero() {
			return "[Invalid Date]"
		}
		return t.UTC().Format(timestampLayout)
	case slog.KindGroup:
		return attrsToMap(value.Group())
	case slog.KindAny:
		return value.Any()
	default:
		return value.String()
	}
}

func nestGroups(fields map[string]any, groups []string) map[string]any {
	for i := len(groups) - 1; i >= 0; i-- {
		fields = map[string]any{groups[i]: fields}
	}
	return fields
}

func mergeMaps(dst, src map[string]any) map[string]any {
	if dst == nil {
		dst = map[string]any{}
	}
	for key, value := range src {
		if existing, ok := dst[key].(map[string]any); ok {
			if incoming, ok := value.(map[string]any); ok {
				dst[key] = mergeMaps(cloneMap(existing), incoming)
				continue
			}
		}
		dst[key] = value
	}
	return dst
}

func cloneMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for key, value := range in {
		if nested, ok := value.(map[string]any); ok {
			out[key] = cloneMap(nested)
			continue
		}
		out[key] = value
	}
	return out
}

func liftReserved(record, fields map[string]any, opts Options) {
	if s, ok := stringField(fields, "requestId"); ok {
		record["requestId"] = trimRunes(s, maxRequestID)
		delete(fields, "requestId")
	}
	if s, ok := stringField(fields, "operationId"); ok {
		record["operationId"] = trimRunes(s, maxOperationID)
		delete(fields, "operationId")
	}
	if s, ok := stringField(fields, "method"); ok {
		record["method"] = trimRunes(s, maxMethod)
		delete(fields, "method")
	}
	if s, ok := stringField(fields, "path"); ok {
		record["path"] = trimRunes(sanitizeURL(s), maxPath)
		delete(fields, "path")
	}
	if s, ok := stringField(fields, "traceId"); ok && traceIDPattern.MatchString(s) {
		record["traceId"] = s
		delete(fields, "traceId")
	}
	if s, ok := stringField(fields, "spanId"); ok && spanIDPattern.MatchString(s) {
		record["spanId"] = s
		delete(fields, "spanId")
	}
	if s, ok := stringField(fields, "source"); ok && (s == "server" || s == "client" || s == "job" || s == "cli") {
		record["source"] = s
		delete(fields, "source")
	}
	if opts.Scope == "" {
		if s, ok := stringField(fields, "scope"); ok && s != "" {
			record["scope"] = cleanText(s, maxScope)
			delete(fields, "scope")
		}
	}
	if nested, ok := fields["data"].(map[string]any); ok {
		delete(fields, "data")
		for key, value := range nested {
			fields[key] = value
		}
	}
}

func stringField(fields map[string]any, key string) (string, bool) {
	value, ok := fields[key]
	if !ok {
		return "", false
	}
	s, ok := value.(string)
	return s, ok
}

func trimRunes(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}

func encodeRecord(record map[string]any) ([]byte, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(record); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

func boundRecord(record map[string]any) map[string]any {
	payload, err := encodeRecord(record)
	if err != nil || len(payload) <= maxRecordBytes {
		return record
	}
	record["data"] = map[string]any{"truncated": true}
	if errValue, ok := record["error"].(map[string]any); ok {
		bounded := map[string]any{"name": "Error", "message": "Error"}
		if name, ok := errValue["name"]; ok {
			bounded["name"] = name
		}
		if message, ok := errValue["message"]; ok {
			bounded["message"] = message
		}
		record["error"] = bounded
	}
	payload, err = encodeRecord(record)
	if err != nil || len(payload) <= maxRecordBytes {
		return record
	}
	if message, ok := record["message"].(string); ok {
		record["message"] = cleanText(message, 512)
	}
	if _, ok := record["error"]; ok {
		record["error"] = map[string]any{"name": "Error", "message": "[Truncated error]"}
	}
	return record
}
