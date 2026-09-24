package narduklogging

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	maxRecordBytes  = 16 * 1024
	maxString       = 2048
	maxFields       = 50
	maxDepth        = 6
	maxNodes        = 500
	redacted        = "[REDACTED]"
	timestampLayout = "2006-01-02T15:04:05.000Z"
	jsMaxSafe       = 9007199254740991
)

var sensitive = map[string]struct{}{
	"password": {}, "passwd": {}, "secret": {}, "token": {}, "apikey": {},
	"authorization": {}, "proxyauthorization": {}, "cookie": {}, "cookies": {},
	"setcookie": {}, "session": {}, "sessionid": {}, "privatekey": {},
	"clientsecret": {}, "body": {}, "requestbody": {}, "responsebody": {},
	"payload": {}, "payment": {}, "cardnumber": {}, "cvv": {}, "email": {},
	"phone": {}, "address": {}, "latitude": {}, "longitude": {}, "prompt": {},
	"completion": {},
}

// Exact segments after camelCase / snake_case / kebab-case split.
var sensitiveSegments = map[string]struct{}{
	"password": {}, "passwd": {}, "secret": {}, "token": {}, "apikey": {},
	"authorization": {}, "cookie": {}, "cookies": {}, "setcookie": {},
	"session": {}, "sessionid": {}, "privatekey": {}, "clientsecret": {},
	"jwt": {}, "bearer": {}, "credential": {}, "credentials": {},
}

// Adjacent segments that together name a secret (`x-api-key` → api+key).
var compoundSegments = map[string]struct{}{
	"apikey": {}, "accesskey": {}, "privatekey": {}, "clientsecret": {}, "setcookie": {},
}

// Keep infix on the punctuation-stripped key only for these compounds.
var sensitiveInfix = []string{"apikey", "accesskey", "privatekey", "authorization"}

// Suffix match on the punctuation-stripped key. Segment splitting cannot see a
// boundary in an all-lowercase concatenation such as `refreshtoken` or
// `dbpassword`, so without this the narrowing would stop redacting names the
// suffix matcher already covered. `tokenizer` / `secretary` / `jwtid` do not
// end in these words, and `tokencount` / `passwordless` are carved out below.
var sensitiveSuffixes = []string{"token", "password", "secret"}

// Metric / method flags that contain `token`, `password`, or `auth` but are not secrets.
var safeNormalizedKeys = map[string]struct{}{
	"tokencount": {}, "passwordless": {}, "authmethod": {}, "authbackend": {},
	"authprovider": {},
}

var reservedSkip = map[string]struct{}{
	"__proto__": {}, "prototype": {}, "constructor": {},
}

// Private marks a value as private. It is redacted before any sink sees the record.
type Private struct{ Value any }

type walkState struct {
	redact       []string
	includeStack bool
	seen         map[uintptr]struct{}
	nodes        int
}

// CleanText strips terminal and line controls and bounds the string.
func CleanText(value string, limit int) string {
	return cleanText(value, limit)
}

func cleanText(value string, limit int) string {
	if limit < 0 {
		limit = 0
	}
	if utf8.RuneCountInString(value) > limit {
		value = string([]rune(value)[:limit])
	}
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range value {
		if r <= 0x1f || (r >= 0x7f && r <= 0x9f) {
			b.WriteByte(' ')
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func normalizeKey(key string) string {
	var b strings.Builder
	b.Grow(len(key))
	for _, r := range strings.ToLower(key) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func keySegments(key string) []string {
	var pieces []string
	var current strings.Builder
	flush := func() {
		if current.Len() > 0 {
			pieces = append(pieces, current.String())
			current.Reset()
		}
	}
	for _, r := range key {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			current.WriteRune(r)
		} else {
			flush()
		}
	}
	flush()
	var segments []string
	for _, piece := range pieces {
		segments = append(segments, splitCamel(piece)...)
	}
	return segments
}

func splitCamel(piece string) []string {
	runes := []rune(piece)
	if len(runes) == 0 {
		return nil
	}
	var parts []string
	start := 0
	for i := 1; i < len(runes); i++ {
		prev, cur := runes[i-1], runes[i]
		split := isASCIILowerOrDigit(prev) && isASCIIUpper(cur)
		if !split && isASCIIUpper(prev) && isASCIIUpper(cur) && i+1 < len(runes) && isASCIILower(runes[i+1]) {
			split = true
		}
		if split {
			parts = append(parts, strings.ToLower(string(runes[start:i])))
			start = i
		}
	}
	parts = append(parts, strings.ToLower(string(runes[start:])))
	return parts
}

func isASCIILowerOrDigit(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
}

func isASCIIUpper(r rune) bool { return r >= 'A' && r <= 'Z' }

func isASCIILower(r rune) bool { return r >= 'a' && r <= 'z' }

// IsSensitiveKey reports whether a field name is treated as a secret.
func IsSensitiveKey(key string, extra []string) bool {
	return isSensitiveKey(key, extra)
}

func isSensitiveKey(key string, extra []string) bool {
	normalized := normalizeKey(key)
	if _, ok := sensitive[normalized]; ok {
		return true
	}
	for _, item := range extra {
		if normalizeKey(item) == normalized {
			return true
		}
	}
	if normalized == "" {
		return false
	}
	if _, ok := safeNormalizedKeys[normalized]; ok {
		return false
	}
	segments := keySegments(key)
	for _, segment := range segments {
		if _, ok := sensitiveSegments[segment]; ok {
			return true
		}
	}
	for i := 0; i < len(segments)-1; i++ {
		if _, ok := compoundSegments[segments[i]+segments[i+1]]; ok {
			return true
		}
	}
	for _, segment := range segments {
		if segment == "auth" {
			return true
		}
	}
	for _, suffix := range sensitiveSuffixes {
		if strings.HasSuffix(normalized, suffix) {
			return true
		}
	}
	for _, part := range sensitiveInfix {
		if strings.Contains(normalized, part) {
			return true
		}
	}
	return false
}

// SanitizeURL strips credentials, query, and fragment. Malformed values never
// fall back to the original string.
func SanitizeURL(value string) string {
	return sanitizeURL(value)
}

func sanitizeURL(value string) string {
	if value == "" {
		return "[empty]"
	}
	if strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "//") {
		parsed, err := url.Parse(value)
		if err != nil {
			return "[invalid URL]"
		}
		path := parsed.Path
		if path == "" {
			path = "/"
		}
		return cleanText(path, 512)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "[invalid URL]"
	}
	if parsed.Scheme == "" {
		return "[invalid URL]"
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "[unsupported URL]"
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return "[invalid URL]"
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	port := parsed.Port()
	if port != "" && !((parsed.Scheme == "http" && port == "80") || (parsed.Scheme == "https" && port == "443")) {
		host += ":" + port
	}
	path := parsed.Path
	if path == "" {
		path = "/"
	}
	return cleanText(parsed.Scheme+"://"+host+path, 512)
}

// SanitizeFields applies the shared privacy contract used by the TypeScript,
// Python, and Swift adapters.
func SanitizeFields(value any, redact []string) map[string]any {
	return sanitizeFields(value, redact, false)
}

func sanitizeFields(value any, redact []string, includeStack bool) (result map[string]any) {
	defer func() {
		if recover() != nil {
			result = map[string]any{"serializationError": "[Unserializable data]"}
		}
	}()
	state := &walkState{
		redact:       redact,
		includeStack: includeStack,
		seen:         map[uintptr]struct{}{},
	}
	walked := walk(value, 0, "", state)
	if m, ok := walked.(map[string]any); ok {
		return m
	}
	return map[string]any{"value": walked}
}

func walk(value any, depth int, key string, state *walkState) any {
	if isSensitiveKey(key, state.redact) {
		return redacted
	}
	if _, ok := value.(Private); ok {
		return redacted
	}
	state.nodes++
	if depth > maxDepth || state.nodes > maxNodes {
		return "[Truncated]"
	}
	if value == nil {
		return nil
	}
	switch v := value.(type) {
	case bool:
		return v
	case string:
		lower := strings.ToLower(key)
		if strings.HasSuffix(lower, "url") || strings.HasSuffix(lower, "uri") {
			return sanitizeURL(v)
		}
		return cleanText(v, maxString)
	case error:
		return sanitizeError(v, state.includeStack, map[uintptr]struct{}{}, 0)
	case time.Time:
		if v.IsZero() {
			return "[Invalid Date]"
		}
		return v.UTC().Format(timestampLayout)
	case int:
		return jsSafeInt(int64(v))
	case int8:
		return jsSafeInt(int64(v))
	case int16:
		return jsSafeInt(int64(v))
	case int32:
		return jsSafeInt(int64(v))
	case int64:
		return jsSafeInt(v)
	case uint:
		return jsSafeUint(uint64(v))
	case uint8:
		return jsSafeUint(uint64(v))
	case uint16:
		return jsSafeUint(uint64(v))
	case uint32:
		return jsSafeUint(uint64(v))
	case uint64:
		return jsSafeUint(v)
	case float32:
		return jsSafeFloat(float64(v))
	case float64:
		return jsSafeFloat(v)
	case []any:
		return walkSlice(v, depth, key, state)
	case map[string]any:
		return walkMap(v, depth, state)
	default:
		return walkReflect(value, depth, key, state)
	}
}

func walkSlice(values []any, depth int, key string, state *walkState) any {
	if p, ok := ptrOf(values); ok {
		if _, seen := state.seen[p]; seen {
			return "[Circular]"
		}
		state.seen[p] = struct{}{}
	}
	limit := len(values)
	if limit > maxFields {
		limit = maxFields
	}
	out := make([]any, 0, limit)
	for i := 0; i < limit; i++ {
		out = append(out, walk(values[i], depth+1, key, state))
	}
	if len(values) > maxFields {
		out = append(out, "[Truncated]")
	}
	return out
}

func walkMap(values map[string]any, depth int, state *walkState) any {
	if p, ok := ptrOf(values); ok {
		if _, seen := state.seen[p]; seen {
			return "[Circular]"
		}
		state.seen[p] = struct{}{}
	}
	out := map[string]any{}
	for field, child := range values {
		if len(out) >= maxFields {
			break
		}
		if _, skip := reservedSkip[field]; skip {
			continue
		}
		out[cleanText(field, 128)] = walk(child, depth+1, field, state)
	}
	return out
}

func walkReflect(value any, depth int, key string, state *walkState) any {
	rv := reflect.ValueOf(value)
	for rv.Kind() == reflect.Interface || rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			return nil
		}
		rv = rv.Elem()
	}
	switch rv.Kind() {
	case reflect.Slice, reflect.Array:
		if p, ok := ptrOf(rv.Interface()); ok {
			if _, seen := state.seen[p]; seen {
				return "[Circular]"
			}
			state.seen[p] = struct{}{}
		}
		length := rv.Len()
		limit := length
		if limit > maxFields {
			limit = maxFields
		}
		out := make([]any, 0, limit)
		for i := 0; i < limit; i++ {
			out = append(out, walk(rv.Index(i).Interface(), depth+1, key, state))
		}
		if length > maxFields {
			out = append(out, "[Truncated]")
		}
		return out
	case reflect.Map:
		if rv.Type().Key().Kind() != reflect.String {
			return "[Unsupported object]"
		}
		if p, ok := ptrOf(rv.Interface()); ok {
			if _, seen := state.seen[p]; seen {
				return "[Circular]"
			}
			state.seen[p] = struct{}{}
		}
		out := map[string]any{}
		for _, mapKey := range rv.MapKeys() {
			if len(out) >= maxFields {
				break
			}
			field := mapKey.String()
			if _, skip := reservedSkip[field]; skip {
				continue
			}
			out[cleanText(field, 128)] = walk(rv.MapIndex(mapKey).Interface(), depth+1, field, state)
		}
		return out
	case reflect.Bool:
		return rv.Bool()
	case reflect.String:
		return walk(rv.String(), depth, key, state)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return jsSafeInt(rv.Int())
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return jsSafeUint(rv.Uint())
	case reflect.Float32, reflect.Float64:
		return jsSafeFloat(rv.Float())
	default:
		return "[Unsupported object]"
	}
}

func ptrOf(value any) (uintptr, bool) {
	rv := reflect.ValueOf(value)
	switch rv.Kind() {
	case reflect.Map, reflect.Slice, reflect.Pointer:
		if rv.IsNil() {
			return 0, false
		}
		return rv.Pointer(), true
	default:
		return 0, false
	}
}

func jsSafeInt(value int64) any {
	if value > jsMaxSafe || value < -jsMaxSafe {
		return strconv.FormatInt(value, 10)
	}
	return value
}

func jsSafeUint(value uint64) any {
	if value > jsMaxSafe {
		return strconv.FormatUint(value, 10)
	}
	return value
}

func jsSafeFloat(value float64) any {
	if math.IsNaN(value) {
		return "nan"
	}
	if math.IsInf(value, 1) {
		return "inf"
	}
	if math.IsInf(value, -1) {
		return "-inf"
	}
	return value
}

func sanitizeError(err error, includeStack bool, seen map[uintptr]struct{}, depth int) map[string]any {
	if err == nil {
		return map[string]any{"name": "Error", "message": "Non-error thrown"}
	}
	if depth >= maxDepth {
		return map[string]any{"name": "Error", "message": "[Circular or truncated cause]"}
	}
	if p, ok := ptrOf(err); ok {
		if _, found := seen[p]; found {
			return map[string]any{"name": "Error", "message": "[Circular or truncated cause]"}
		}
		seen[p] = struct{}{}
	}
	name := errorName(err)
	message := cleanText(err.Error(), maxString)
	result := map[string]any{"name": cleanText(name, 256), "message": message}
	if includeStack {
		result["stack"] = cleanText(fmt.Sprintf("%+v", err), 4096)
	}
	if cause := errors.Unwrap(err); cause != nil {
		result["cause"] = sanitizeError(cause, includeStack, seen, depth+1)
	}
	return result
}

func errorName(err error) string {
	t := reflect.TypeOf(err)
	if t == nil {
		return "Error"
	}
	if t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Name() == "" {
		return "Error"
	}
	return t.Name()
}

func errorFields(value any, includeStack bool, depth int) map[string]any {
	if depth >= maxDepth {
		return map[string]any{"name": "Error", "message": "[Circular or truncated cause]"}
	}
	if err, ok := value.(error); ok {
		return sanitizeError(err, includeStack, map[uintptr]struct{}{}, depth)
	}
	fields, ok := value.(map[string]any)
	if !ok {
		if s, ok := value.(string); ok {
			return map[string]any{"name": "Error", "message": cleanText(s, maxString)}
		}
		return map[string]any{"name": "Error", "message": "Non-error thrown"}
	}
	result := map[string]any{"name": "Error", "message": "Non-error thrown"}
	if s, ok := fields["name"].(string); ok {
		result["name"] = cleanText(s, 256)
	}
	if s, ok := fields["message"].(string); ok {
		result["message"] = cleanText(s, maxString)
	}
	switch code := fields["code"].(type) {
	case string:
		result["code"] = cleanText(code, 128)
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		result["code"] = cleanText(fmt.Sprint(code), 128)
	}
	if includeStack {
		if s, ok := fields["stack"].(string); ok {
			result["stack"] = cleanText(s, 4096)
		}
	}
	if cause, ok := fields["cause"]; ok {
		result["cause"] = errorFields(cause, includeStack, depth+1)
	}
	return result
}
