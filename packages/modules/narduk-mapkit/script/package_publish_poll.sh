#!/usr/bin/env bash
set -euo pipefail

# Agent Hub-style package poller. This never touches the live editing checkout.
# It builds from a throwaway clone, publishes a local tarball, and records the
# deployed SHA only after publish succeeds.

DEPLOY_DIR="${NARDUK_MAPKIT_DEPLOY_DIR:-$HOME/Library/Application Support/NardukMapKit/deploy}"
SRC="$DEPLOY_DIR/src"
MARKER="$DEPLOY_DIR/last-published-sha"
LOCKDIR="$DEPLOY_DIR/package-publish.lock.d"
REPO_URL="${NARDUK_MAPKIT_REPO_URL:-git@github.com:loganrenz/narduk-mapkit.git}"
LOCK_STALE_SECONDS="${NARDUK_MAPKIT_LOCK_STALE_SECONDS:-1800}"

log() { printf '%s narduk-mapkit-publish: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

mkdir -p "$DEPLOY_DIR"

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  mtime="$(stat -f %m "$LOCKDIR" 2>/dev/null || echo 0)"
  now="$(date +%s)"
  if [ "$((now - mtime))" -gt "$LOCK_STALE_SECONDS" ]; then
    log "stealing stale lock (age $((now - mtime))s)"
    rmdir "$LOCKDIR" 2>/dev/null || true
    mkdir "$LOCKDIR" 2>/dev/null || { log "could not acquire lock; skipping"; exit 0; }
  else
    log "another run holds the lock; skipping"
    exit 0
  fi
fi
trap 'rmdir "$LOCKDIR" 2>/dev/null || true' EXIT

if [ ! -d "$SRC/.git" ]; then
  log "cloning publish source -> $SRC"
  git clone "$REPO_URL" "$SRC"
fi

cd "$SRC"

if [ -n "$(git status --porcelain)" ]; then
  git reset --hard HEAD >/dev/null 2>&1 || true
  git clean -fd >/dev/null 2>&1 || true
fi

git fetch origin main --prune
origin_sha="$(git rev-parse origin/main)"
last="$(cat "$MARKER" 2>/dev/null || echo none)"

if [ "$origin_sha" = "$last" ]; then
  log "no-op: already published ${origin_sha:0:8}"
  exit 0
fi

log "publishing ${last:0:8} -> ${origin_sha:0:8}"
git reset --hard origin/main

corepack enable
pnpm install --frozen-lockfile
pnpm run publish:local

echo "$origin_sha" > "$MARKER"
log "complete: now at ${origin_sha:0:8}"
