#!/usr/bin/env bash
# Preflight for an asset kit. usage: preflight.sh [--backend grok|sol|astra|all] [KIT_DIR]   (exit 0 = ready, 1 = something to fix)
# Backend grok (default): grok on PATH and signed in (test -f ~/.grok/auth.json, never read). Backends sol and astra: Codex >= 0.159
# (0.158 rejects gpt-6.1-sol on a ChatGPT account), the model listed in ~/.codex/models_cache.json, and the Codex quota.
# Always: ImageMagick 7, potrace, librsvg and the Python image modules. Pass the kit once kit.json has a logo.wordmark block: a
# missing fonttools + uharfbuzz venv ($KIT/.venv) is then a FAIL, otherwise a warning with the venv recipe.
set -u
rc=0; ok(){ echo "ok   $*"; }; bad(){ echo "FAIL $*"; rc=1; }
BACKEND=grok
if [ "${1:-}" = "--backend" ]; then BACKEND="${2:?--backend needs grok, sol, astra or all}"; shift 2; fi
case "$BACKEND" in grok|sol|astra|all) ;; *) echo "unknown backend $BACKEND (grok, sol, astra, all)" >&2; exit 2 ;; esac
want(){ [ "$BACKEND" = all ] || [ "$BACKEND" = "$1" ]; }

if want grok; then
  if command -v grok >/dev/null; then ok "grok $(grok --version 2>/dev/null | head -1)"; else bad "grok not found on PATH"; fi
  if test -f "$HOME/.grok/auth.json"; then ok "grok signed in (~/.grok/auth.json present)"
  else bad "grok is not signed in (run grok once and sign in; never read ~/.grok/auth.json)"; fi
fi

if want sol || want astra; then
  CODEX="${CODEX:-codex}"
  # every codex on PATH (volta + brew installs) must be new enough: a stale one wins depending on PATH order
  for bin in $(which -a "$CODEX" 2>/dev/null | awk '!s[$0]++'); do
    v="$("$bin" --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
    IFS=. read -r a b _ <<<"${v:-0.0.0}"
    if [ "$a" -gt 0 ] || [ "$b" -ge 159 ]; then ok "codex $v ($bin)"
    else bad "codex ${v:-?} ($bin) < 0.159 rejects gpt-6.1-sol on a ChatGPT account. Fix: volta install @openai/codex@latest; brew upgrade codex"; fi
  done
  command -v "$CODEX" >/dev/null || bad "codex not found (volta install @openai/codex@latest)"
  for pair in "sol:gpt-6.1-sol" "astra:gpt-6-astra"; do
    want "${pair%%:*}" || continue
    slug="${pair#*:}"
    if SLUG="$slug" python3 - <<'PY'
import json, os, sys
p = os.path.expanduser("~/.codex/models_cache.json")
try:
    d = json.load(open(p)); ms = d.get("models", d)
    sys.exit(0 if any(m.get("slug") == os.environ["SLUG"] for m in ms) else 1)
except Exception:
    sys.exit(2)
PY
    then ok "$slug listed in ~/.codex/models_cache.json"
    else bad "$slug not in ~/.codex/models_cache.json (run any codex command to refresh it; still missing = not available to this login)"; fi
  done
  HERE="$(cd "$(dirname "$0")" && pwd)"
  for q in "$HERE/../../../scripts/model-usage-status.py" "$HOME/.local/share/agent-infrastructure/scripts/model-usage-status.py"; do
    [ -f "$q" ] && { python3 "$q" --json 2>/dev/null | python3 -c '
import json,sys
try:
    for p in json.load(sys.stdin)["providers"]:
        if p.get("provider")=="codex": print("note codex quota: %s%% used, state %s (%s)" % (p.get("percent_used"), p.get("state"), p.get("plan_type")))
except Exception: print("note quota probe gave no codex row (unknown is not zero)")'; break; }
  done
fi

command -v magick >/dev/null && ok "magick" || bad "magick missing (brew install imagemagick; kit.py keep and derive need ImageMagick 7)"
for t in potrace rsvg-convert python3; do command -v "$t" >/dev/null && ok "$t" || bad "$t missing (brew install potrace librsvg)"; done
python3 - <<'PY' || rc=1
import importlib.util
miss = [m for m in ("PIL", "numpy", "scipy") if importlib.util.find_spec(m) is None]
print("ok   python modules" if not miss else "FAIL python modules missing: %s (pip3 install pillow numpy scipy)" % miss)
raise SystemExit(1 if miss else 0)
PY
# wordmark deps: python3 only sees them from the kit venv (macOS system python is PEP 668)
KIT=""; [ -d "${1:-}" ] && KIT="$(cd "$1" && pwd)"
PY=python3; [ -n "$KIT" ] && [ -x "$KIT/.venv/bin/python" ] && PY="$KIT/.venv/bin/python"
NEED=0; [ -n "$KIT" ] && [ -f "$KIT/kit.json" ] && grep -q '"wordmark"' "$KIT/kit.json" && NEED=1
if "$PY" -c "import fontTools, uharfbuzz" 2>/dev/null; then ok "fonttools+uharfbuzz importable by $PY (wordmark): run kit.py derive with that python"
else
  MSG="fonttools/uharfbuzz not importable by $PY, so the wordmark (kit.py derive of the app icon) fails. Fix: python3 -m venv --system-site-packages \$KIT/.venv && \$KIT/.venv/bin/pip install fonttools uharfbuzz, then run \$KIT/tools/kit.py derive with \$KIT/.venv/bin/python (see SKILL.md)"
  if [ "$NEED" = 1 ]; then bad "$MSG"; else echo "warn $MSG (only needed once kit.json has a logo.wordmark block; re-run preflight.sh with the kit dir then)"; fi
fi
exit $rc
