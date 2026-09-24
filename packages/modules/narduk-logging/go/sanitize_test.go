package narduklogging

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

type privacyFixture struct {
	Name     string         `json:"name"`
	Input    map[string]any `json:"input"`
	Expected map[string]any `json:"expected"`
}

func schemaPath(t *testing.T, name string) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(file), "..", "schema", name)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("schema %s: %v", path, err)
	}
	return path
}

func loadFixtures(t *testing.T) []privacyFixture {
	t.Helper()
	raw, err := os.ReadFile(schemaPath(t, "fixtures.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []privacyFixture
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	if len(fixtures) == 0 {
		t.Fatal("fixtures.json was empty")
	}
	return fixtures
}

func jsonValue(t *testing.T, value any) any {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// TestSharedPrivacyFixtures fails if SanitizeFields does not match the shared
// contract. A pass-through stub (or slog.NewJSONHandler dumping raw attrs)
// cannot satisfy these cases.
func TestSharedPrivacyFixtures(t *testing.T) {
	for _, fixture := range loadFixtures(t) {
		t.Run(fixture.Name, func(t *testing.T) {
			got := SanitizeFields(fixture.Input, nil)
			if !reflect.DeepEqual(jsonValue(t, got), jsonValue(t, fixture.Expected)) {
				gotJSON, _ := json.Marshal(got)
				wantJSON, _ := json.Marshal(fixture.Expected)
				t.Fatalf("SanitizeFields mismatch\ngot  %s\nwant %s", gotJSON, wantJSON)
			}
		})
	}
}

func TestExtraRedactOverridesCarveOut(t *testing.T) {
	if IsSensitiveKey("tokenCount", nil) {
		t.Fatal("tokenCount must stay visible without an extra redact list")
	}
	if !IsSensitiveKey("tokenCount", []string{"tokenCount"}) {
		t.Fatal("extra redact must override the tokenCount carve-out")
	}
	if IsSensitiveKey("", nil) {
		t.Fatal("empty key is not sensitive")
	}
}
