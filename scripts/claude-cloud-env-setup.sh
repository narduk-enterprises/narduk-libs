#!/usr/bin/env bash
# Claude Code on the web: "narduk-libs" environment setup script.
#
# Runs as root on Anthropic's Ubuntu 24.04 VM before Claude Code starts, on an
# uncached session only. The result is snapshotted for about 7 days, or until
# this script or the allowed hosts change. It must exit 0 within about
# 5 minutes, so every step is best-effort and the script never aborts.
#
# Layers narduk-libs needs on top of the estate baseline:
#   1. The estate baseline: agent-infrastructure's scripts/claude-cloud-env-setup.sh
#      (Node 24, pnpm through corepack, shellcheck, PyYAML, the estate manual
#      at ~/.local/share/agent-infrastructure, and ~/.claude/CLAUDE.md).
#   2. uv at the version logging-languages.yml pins, for the narduk-logging
#      Python quality gate.
#   3. A warm `pnpm install --frozen-lockfile` when the repo is already on disk,
#      plus a SessionStart hook that installs if node_modules is missing.
#   4. Playwright Chromium and its system libraries through the lockfile's own
#      CLI (`pnpm exec playwright install --with-deps chromium`, as ci.yml does),
#      for the per-package test:e2e jobs.
#
# Steps 3 and 4 are capped at 120 s each so the whole script fits the budget
# after the estate baseline. A step that times out is skipped, not fatal.
#
# Not installed: the Swift toolchain for narduk-logging's Swift half. It is
# about 1 GB and does not fit the setup budget. Run
# `python3 scripts/install-swift-linux.py` inside a session when you need it.
#
# This file is the reviewed source. The environment's "Setup script" field at
# claude.ai/code holds a pasted copy. Edit this file first, then paste the whole
# file into that field again (docs/operations/claude-cloud-environment.md).
#
# Holds no credentials and must never hold any. Every @narduk-enterprises
# package here is a workspace package, so install needs no registry token.
set -uo pipefail

UV_PIN="0.12.7"   # .github/workflows/logging-languages.yml setup-uv version
AI_ROOT="${HOME}/.local/share/agent-infrastructure"
AI_URL="https://github.com/narduk-enterprises/agent-infrastructure.git"
REPO_DIR="/home/user/narduk-libs"

log(){ printf '[narduk-libs-setup] %s\n' "$*"; }

# Same cloud-VM check as the estate script: Linux plus a cloud marker.
[ "$(uname -s)" = "Linux" ] || { log "not Linux; refusing"; exit 0; }
if [ "${AGENT_CLOUD:-0}" != "1" ] && [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  log "no cloud marker (AGENT_CLOUD, CLAUDE_CODE_REMOTE); refusing"
  exit 0
fi

# --- 1. estate baseline ----------------------------------------------------------
if [ ! -d "${AI_ROOT}/.git" ]; then
  mkdir -p "$(dirname "$AI_ROOT")"
  git clone --quiet --depth 1 "$AI_URL" "$AI_ROOT" 2>/dev/null \
    || log "WARN: could not clone agent-infrastructure"
fi
if [ -f "${AI_ROOT}/scripts/claude-cloud-env-setup.sh" ]; then
  bash "${AI_ROOT}/scripts/claude-cloud-env-setup.sh" || log "WARN: estate baseline exited nonzero"
else
  log "WARN: estate baseline script missing; Node 24 and pnpm may be absent"
fi
export PATH="/opt/node24/bin:${PATH}"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
hash -r

# --- 2. uv -------------------------------------------------------------------------
if [ "$(uv --version 2>/dev/null | awk '{print $2}')" != "$UV_PIN" ]; then
  python3 -m pip install -q --break-system-packages "uv==${UV_PIN}" 2>/dev/null \
    || python3 -m pip install -q "uv==${UV_PIN}" 2>/dev/null || log "WARN: uv install failed"
fi

# --- 3. dependencies, 4. Playwright Chromium -----------------------------------------
# Playwright comes from the lockfile, so it needs the install first. Without the
# repo on disk there is no lockfile, and the e2e browser is left to the session.
if [ -f "${REPO_DIR}/pnpm-lock.yaml" ]; then
  if (cd "$REPO_DIR" && timeout 120 pnpm install --frozen-lockfile >/dev/null 2>&1); then
    log "pnpm install done"
    (cd "$REPO_DIR" && timeout 120 pnpm exec playwright install --with-deps chromium >/dev/null 2>&1) \
      && log "playwright chromium ready" \
      || log "WARN: playwright chromium install failed or timed out"
  else
    log "WARN: pnpm install failed or timed out; the session hook retries, then run: pnpm exec playwright install --with-deps chromium"
  fi
else
  log "repo not on disk at setup; skipping pnpm install and Playwright"
fi

# If the snapshot has no node_modules, install at session start. This hook is
# user-level because a multi-repository session reads no repo .claude/settings.json.
python3 - "$HOME" "$REPO_DIR" <<'PY' || true
import json, os, sys
home, repo = sys.argv[1], sys.argv[2]
path = os.path.join(home, ".claude", "settings.json")
try:
    cfg = json.load(open(path))
except Exception:
    cfg = {}
cmd = (f'[ "$CLAUDE_CODE_REMOTE" = true ] && [ -f {repo}/pnpm-lock.yaml ] && '
       f'[ ! -d {repo}/node_modules ] && '
       f'(cd {repo} && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile >/dev/null 2>&1); true')
hooks = cfg.setdefault("hooks", {}).setdefault("SessionStart", [])
if not any(cmd in json.dumps(h) for h in hooks):
    hooks.append({"matcher": "", "hooks": [{"type": "command", "command": cmd, "timeout": 300}]})
os.makedirs(os.path.dirname(path), exist_ok=True)
json.dump(cfg, open(path, "w"), indent=2)
PY

cat >> "${HOME}/.claude/CLAUDE.md" <<EOF

## narduk-libs environment
This environment is set up for narduk-enterprises/narduk-libs. Read the repo's
AGENTS.md first. \`pnpm run preflight\` is the cheap PR gate. uv is installed.
Playwright Chromium usually is; if an e2e run cannot find it, run
\`pnpm exec playwright install --with-deps chromium\`. Swift is not installed: run
\`python3 scripts/install-swift-linux.py\` if you need the narduk-logging Swift gate.
EOF

log "done"
exit 0
